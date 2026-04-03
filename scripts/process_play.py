#!/usr/bin/env python3
"""Build a normalized single-play JSON file from NFL Big Data Bowl tracking CSVs."""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pandas as pd

FIELD_LENGTH_YARDS = 120.0
FIELD_WIDTH_YARDS = 53.3
DEFAULT_FRAME_RATE_HZ = 10


@dataclass(frozen=True)
class PlaySelection:
    game_id: int
    play_id: int


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description='Extract one play from Big Data Bowl CSVs into sample_play.json')
    parser.add_argument('--tracking', type=Path, default=Path('data/tracking_week_1.csv'), help='Path to tracking_week_1.csv')
    parser.add_argument('--plays', type=Path, default=Path('data/plays.csv'), help='Path to plays.csv')
    parser.add_argument('--game-id', type=int, default=2022090800, help='Target gameId')
    parser.add_argument('--play-id', type=int, default=343, help='Target playId')
    parser.add_argument('--output', type=Path, default=Path('public/data/sample_play.json'), help='Output JSON path')
    return parser.parse_args()


def _clean_float(value: Any, default: float = 0.0) -> float:
    if pd.isna(value):
        return default

    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _clean_int_string(value: Any) -> str:
    if pd.isna(value):
        return ''
    try:
        return str(int(float(value)))
    except (TypeError, ValueError):
        return str(value).strip()


def _normalize_point(x: float, y: float, direction: str) -> tuple[float, float]:
    if direction == 'left':
        x = FIELD_LENGTH_YARDS - x
        y = FIELD_WIDTH_YARDS - y

    x = max(0.0, min(FIELD_LENGTH_YARDS, x))
    y = max(0.0, min(FIELD_WIDTH_YARDS, y))
    return x, y


def _normalize_dir(angle_degrees: float, direction: str) -> float:
    # Rotating coordinates by 180 degrees for leftward plays preserves movement orientation.
    if direction == 'left':
        angle_degrees = angle_degrees + 180.0
    return angle_degrees % 360.0


def _to_entity_id(team_key: str, nfl_id: Any, display_name: str, frame_id: int, row_idx: int) -> str:
    if team_key == 'football' or display_name.lower() == 'football':
        return 'football'
    if pd.notna(nfl_id):
        return f"{team_key}-{int(float(nfl_id))}"
    return f"{team_key}-unknown-{frame_id}-{row_idx}"


def build_play_json(selection: PlaySelection, tracking_path: Path, plays_path: Path) -> dict[str, Any]:
    plays_df = pd.read_csv(
        plays_path,
        usecols=['gameId', 'playId', 'playDescription', 'possessionTeam'],
        dtype={'gameId': 'int64', 'playId': 'int64'},
    )
    plays_filtered = plays_df[(plays_df['gameId'] == selection.game_id) & (plays_df['playId'] == selection.play_id)]
    if plays_filtered.empty:
        raise ValueError(f'Play {selection.game_id}/{selection.play_id} not found in {plays_path}.')

    play_row = plays_filtered.iloc[0]
    possession_team = str(play_row['possessionTeam'])
    play_description = str(play_row.get('playDescription', '')).strip()

    tracking_columns = pd.read_csv(tracking_path, nrows=0).columns.tolist()
    has_club = 'club' in tracking_columns
    has_team = 'team' in tracking_columns
    has_display_name = 'displayName' in tracking_columns
    has_jersey = 'jerseyNumber' in tracking_columns

    if not has_club and not has_team:
        raise ValueError(f'Expected one of [club, team] in {tracking_path}, got {tracking_columns}.')

    required_usecols = ['gameId', 'playId', 'frameId', 'playDirection', 'x', 'y', 's', 'dir', 'nflId']
    if has_club:
        required_usecols.append('club')
    if has_team:
        required_usecols.append('team')
    if has_display_name:
        required_usecols.append('displayName')
    if has_jersey:
        required_usecols.append('jerseyNumber')

    tracking_df = pd.read_csv(
        tracking_path,
        usecols=required_usecols,
        dtype={'gameId': 'int64', 'playId': 'int64', 'frameId': 'int64'},
    )
    tracking_filtered = tracking_df[
        (tracking_df['gameId'] == selection.game_id) & (tracking_df['playId'] == selection.play_id)
    ].copy()

    if tracking_filtered.empty:
        raise ValueError(f'No tracking rows found for play {selection.game_id}/{selection.play_id} in {tracking_path}.')

    tracking_filtered.sort_values(['frameId'], inplace=True)
    frame_ids = sorted(tracking_filtered['frameId'].unique().tolist())
    first_frame_id = int(frame_ids[0])

    frames: list[dict[str, Any]] = []

    for frame_id, frame_df in tracking_filtered.groupby('frameId', sort=True):
        entities: list[dict[str, Any]] = []
        seen_ids: set[str] = set()

        for row_idx, row in frame_df.iterrows():
            direction = str(row['playDirection']).strip().lower()
            x_raw = _clean_float(row['x'])
            y_raw = _clean_float(row['y'])
            speed = _clean_float(row['s'])
            heading = _normalize_dir(_clean_float(row['dir']), direction)
            x_norm, y_norm = _normalize_point(x_raw, y_raw, direction)

            team_value = str(row['team']).strip().lower() if has_team else ''
            club_value = str(row['club']).strip() if has_club else ''
            display_name = str(row['displayName']).strip() if has_display_name else ''
            jersey = _clean_int_string(row['jerseyNumber']) if has_jersey else ''

            if has_club:
                team_key = club_value.lower()
            elif team_value in {'home', 'away', 'football'}:
                team_key = team_value
            else:
                team_key = team_value

            entity_id = _to_entity_id(team_key, row['nflId'], display_name, int(frame_id), int(row_idx))
            if entity_id in seen_ids:
                continue
            seen_ids.add(entity_id)

            if team_key == 'football' or display_name.lower() == 'football':
                team = 'football'
                player_name = 'Football'
            else:
                if has_team and team_value in {'home', 'away'}:
                    team = team_value
                elif has_team and team_value and team_value != 'football':
                    team = 'home' if team_value.upper() == possession_team.upper() else 'away'
                else:
                    team = 'home' if club_value == possession_team else 'away'

                if display_name:
                    player_name = display_name
                elif pd.notna(row['nflId']):
                    player_name = f"#{jersey or '?'} ({int(float(row['nflId']))})"
                else:
                    player_name = f"#{jersey or '?'}"

            entities.append(
                {
                    'entityId': entity_id,
                    'displayName': player_name,
                    'team': team,
                    'x': round(x_norm, 3),
                    'y': round(y_norm, 3),
                    's': round(speed, 3),
                    'dir': round(heading, 3),
                }
            )

        timestamp_ms = (int(frame_id) - first_frame_id) * int(1000 / DEFAULT_FRAME_RATE_HZ)
        frames.append(
            {
                'frameId': int(frame_id),
                'timestampMs': timestamp_ms,
                'entities': entities,
            }
        )

    return {
        'meta': {
            'gameId': str(selection.game_id),
            'playId': str(selection.play_id),
            'frameRateHz': DEFAULT_FRAME_RATE_HZ,
            'source': tracking_path.name,
            'description': play_description,
        },
        'frames': frames,
    }


def main() -> None:
    args = parse_args()
    payload = build_play_json(
        PlaySelection(game_id=args.game_id, play_id=args.play_id),
        tracking_path=args.tracking,
        plays_path=args.plays,
    )

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, indent=2), encoding='utf-8')
    print(f'Wrote {len(payload["frames"])} frames to {args.output}')


if __name__ == '__main__':
    main()




