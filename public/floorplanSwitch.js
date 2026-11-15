// Whether the Floorplan tab is shown (plugin option showFloorplan, default
// on). App.js sets it from the settings; the Floorplan tab, its route and the
// hints and counts that mention the floorplan read it.

let shown = true

export function setFloorplanShown (value) {
  shown = value !== false
}

export function floorplanShown () {
  return shown
}
