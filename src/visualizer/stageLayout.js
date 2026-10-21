// A combine step has three real regions: the result and the two inputs. Put
// the result across the top and the inputs side by side so the whole
// relationship fits the stage without shrinking or dropping values.
export function algorithmLayout(regions) {
  const count = Array.isArray(regions) ? regions.length : 0;
  if (count >= 3) return "split";
  return count === 2 ? "pair" : "single";
}
