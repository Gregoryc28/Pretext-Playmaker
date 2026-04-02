import { ControlPanel } from './components/ControlPanel';
import { FieldView } from './components/FieldView';

export function App(): JSX.Element {
  return (
    <main className="app-shell">
      <aside className="panel-shell">
        <ControlPanel />
      </aside>
      <section className="field-shell">
        <FieldView />
      </section>
    </main>
  );
}

