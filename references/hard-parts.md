# The hard parts

One problem is open, the flow layout geometry. Do not present it as solved, and do not start on it mid-build without
saying so: it reshapes the canvas enough to be its own decision. The rest of this file is what the canvas structurally
cannot show, which belongs in the honest list at handover.

## 1. The flow layout geometry (open)

The edges are honest; the geometry is not. A long flow is a very wide strip. At a zoom where the shape of the diagram is
legible, every frame in it is a gray rectangle; at a zoom where the screens can be judged, the shape is off-screen. Sparse
rows also leave large empty areas inside a group's panel, and whole-page captures make frame heights very unequal, which
makes it worse.

**What good would look like:** a wide flow readable as a whole and at frame level without two different zooms. The obvious
candidate, wrapping a long spine into stacked rows, reshapes the diagram, and that is a design decision for the canvas's
maintainers rather than an implementation detail.

**What must not break while fixing it:** no edge ever crosses a frame it does not belong to. A frame occupies only its own
column, so an edge between neighboring columns goes straight across the gap; an edge spanning two or more columns goes down
out of its frame, along a clear lane under the diagram, and up into the frame it lands on, one lane per edge. The oracle
samples forty points along every edge path and fails if any lands inside a frame that is not one of its two ends. Any new
layout has to keep passing that.

## 2. What the canvas structurally cannot show

- **A picture cannot be interrogated.** Truth is proved at capture time and goes stale until the next capture. The drift
  note catches a frame whose files changed; nothing catches a design that changed outside the files a frame's stamp knows.
- **Surfaces that cannot be captured honestly.** A camera page inside a frame shows the camera blocked by the frame's
  permissions policy, a state no user is ever in. Name it in the declaration and do not draw it.
- **States with no way in.** A state reached only by browsing, with no URL, no steps and no network rule that reaches it.
- **Devices not declared.** The canvas draws desktop and phone screens when both are declared; a device with no screens is
  simply absent, so say so.
- **A request the app's server makes** never passes through the browser, so no network rule can hold or answer it.
