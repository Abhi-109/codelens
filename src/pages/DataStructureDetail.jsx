/* One data structure's page, e.g. /visualizer/data-structures/stack. The
 * type comes from the URL; unknown types get the 404 state from the lab. */

import DataStructureLab from '../datastructures/DataStructureLab.jsx';

export default function DataStructureDetail({ type }) {
  return <DataStructureLab type={type} />;
}
