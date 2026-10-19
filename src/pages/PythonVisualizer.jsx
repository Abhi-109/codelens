/* The Python visualizer route. This is the existing playground, unchanged:
 * App.jsx still owns the tracer wiring, the panes and every panel. All this
 * route adds is the shell around it. */

import App from '../App.jsx';

export default function PythonVisualizer() {
  return <App />;
}
