# ArchiLite drawing file format (version 3)

ArchiLite saves drawings as UTF-8 JSON text with the extension `.archilite`. The format is plain and
documented so you can read, diff, generate and repair drawings with any text editor or script.

An example ships with the app: [`public/examples/bracket.archilite`](../public/examples/bracket.archilite).
Open it in the [file inspector](https://leon14026.github.io/2D-CAD/inspect.html) to see what it
contains.

## Layout

```json
{
  "format": "archilite",
  "version": 3,
  "title": "Example bracket",
  "units": "mm",
  "currentLayer": 2,
  "currentDimStyle": "ISO",
  "currentSheet": "Sheet 1",
  "nextId": 21,
  "dimStyles": [
    {"name":"ISO","textHeight":3.5,"arrowSize":3,"extGap":1,"extOver":2,"textGap":1,"precision":2,"anglePrecision":1,"centreMark":2.5,"centreOver":2}
  ],
  "layers": [
    {"id":2,"name":"Outline","color":"#1f2a33","linetype":"continuous","lineweight":0.5,"visible":true,"locked":false}
  ],
  "sheets": [
    {"name":"Sheet 1","size":"A4"}
  ],
  "blocks": [],
  "entities": [
    {"id":6,"layer":3,"z":6,"color":"byLayer","linetype":"byLayer","lineweight":"byLayer","geom":{"kind":"circle","center":{"x":10,"y":10},"radius":4}}
  ],
  "notes": [
    {"id":22,"layer":2,"z":22,"color":"byLayer","lineweight":"byLayer","body":{"kind":"diameter","target":6,"at":{"x":10,"y":25},"style":"ISO"}}
  ],
  "inserts": [],
  "constraints": []
}
```

ArchiLite always writes one layer, sheet, block, entity, note, insert, constraint or dimension style per line, in
drawing order, so the same drawing always produces the same text and changes show up as clean line diffs in git.

## Top-level fields

All fields are required. Any field not listed here is rejected.

| Field | Type | Meaning |
|---|---|---|
| `format` | `"archilite"` | Identifies the file. |
| `version` | whole number | File format version. This document describes version **3**. A file with a higher version is refused with a message saying a newer ArchiLite saved it. Version 1 and 2 files still open. |
| `title` | text, 1–200 characters | Drawing title. Leading and trailing spaces are removed. |
| `units` | `"mm"`, `"cm"`, `"m"`, `"in"` or `"ft"` | What one drawing unit means. All coordinates and radii are in these units. |
| `currentLayer` | layer id | The layer new entities go on. |
| `currentDimStyle` | style name | The dimension style new dimensions and leaders use. Must name one of `dimStyles`. *(version 2)* |
| `currentSheet` | sheet name | The sheet the view shows and that new objects go on. Must name one of `sheets`. *(version 3)* |
| `nextId` | whole number | The next id ArchiLite will hand out. Must be greater than every id in the file. |
| `dimStyles` | list of dimension styles | At least one, at most 50, names unique ignoring upper/lower case. *(version 2)* |
| `layers` | list of layers | At least one. The order is the order shown in the layer list. |
| `sheets` | list of sheets | At least one, at most 32, names unique ignoring upper/lower case. *(version 3)* |
| `blocks` | list of blocks | Named reusable geometry. May be empty. At most 100. *(version 3)* |
| `entities` | list of entities | May be empty. |
| `notes` | list of notes | Dimensions, text, leaders, centre marks, hatches and title blocks. May be empty. *(version 2)* |
| `inserts` | list of block inserts | Placed copies of a block. May be empty. *(version 3)* |
| `constraints` | list of constraints | Geometric and dimensional relations. May be empty. *(version 3)* |

Layers, entities, notes, inserts and constraints share **one id space**: an id can't belong to two
of them at once. Ids are whole numbers from 1 up. Sheets and blocks are **named**, like dimension
styles: they do not take ids.

A version 1 file has none of the fields marked *(version 2)* or *(version 3)*. A version 2 file has
none of the fields marked *(version 3)*. Older files open with the default `ISO` style, one A4 sheet
called `Sheet 1`, and no blocks, inserts or constraints, and are saved as version 3 the next time.

## Layer

| Field | Type | Meaning |
|---|---|---|
| `id` | whole number | Unique id. |
| `name` | text, 1–64 characters | Unique, ignoring upper/lower case. |
| `color` | `"#rrggbb"` (lowercase hex) | Colour of entities that use `byLayer`. |
| `linetype` | linetype name (below) | Linetype of entities that use `byLayer`. |
| `lineweight` | lineweight (below) | Line width on paper, in mm, for entities that use `byLayer`. |
| `visible` | `true` / `false` | Whether the layer is shown. |
| `locked` | `true` / `false` | A locked layer's entities can't be added, changed or deleted. |

## Entity

| Field | Type | Meaning |
|---|---|---|
| `id` | whole number | Unique id. |
| `layer` | layer id | Must be an existing layer. |
| `z` | number | Drawing order: lower is drawn first. Ties are broken by id. New entities get `z = id`. |
| `color` | `"byLayer"` or `"#rrggbb"` | Own colour, or the layer's. |
| `linetype` | `"byLayer"` or a linetype name | |
| `lineweight` | `"byLayer"` or a lineweight | |
| `geom` | shape (below) | The geometry. |
| `sheet` | sheet name | Which sheet this entity lives on. Omitted when it is the first sheet. *(version 3)* |

## Shapes

Coordinates are in drawing units with **y pointing up**. Angles are in **radians**, measured
anticlockwise from the +x axis.

| `kind` | Other fields | Rules |
|---|---|---|
| `"segment"` | `start`, `end`: `{"x":…, "y":…}` | Start and end must differ. |
| `"circle"` | `center`, `radius` | Radius greater than 0. |
| `"arc"` | `center`, `radius`, `start`, `sweep` | `start` is the start angle; ArchiLite stores it in [0, 2π). `sweep` is signed: positive runs anticlockwise, negative clockwise, with 0 < \|sweep\| < 2π. |
| `"polyline"` | `vertices`, `closed` | At least two vertices, each `{"x":…, "y":…, "bulge":…}`. `closed: true` joins the last vertex back to the first. |

**Bulge** describes the edge from a vertex to the next one, using the same convention as the DXF
format's lightweight polylines:

- `0` is a straight edge (and is the default if `bulge` is left out);
- otherwise `bulge = tan(sweep / 4)`, where `sweep` is the arc's angle;
- positive bulges arc anticlockwise, negative bulges clockwise;
- `1` is a half circle, and `tan(π/8) ≈ 0.4142` is a quarter circle (a 90° corner fillet).

## Notes

Notes are the annotations: everything that explains the geometry rather than being part of it.
A note has the same `layer`, `z`, `color` and `lineweight` fields as an entity (no `linetype`),
and a `body` that says what it is.

| Field | Type | Meaning |
|---|---|---|
| `id` | whole number | Unique id. |
| `layer` | layer id | Must be an existing layer. |
| `z` | number | Drawing order among notes, lower first. Hatches are always drawn under the entities; every other note is drawn over them. |
| `color` | `"byLayer"` or `"#rrggbb"` | |
| `lineweight` | `"byLayer"` or a lineweight | |
| `body` | note body (below) | |
| `sheet` | sheet name | Which sheet this note lives on. Omitted when it is the first sheet. *(version 3)* |

### Dimension styles

How dimensions look. The ISO default is called `ISO`. All sizes are in drawing units and are
lengths *on paper* at 1:1, so a text height of 3.5 is 3.5 mm in a drawing made in millimetres.

| Field | Type | Meaning |
|---|---|---|
| `name` | text, 1–32 characters | Unique, ignoring upper/lower case. |
| `textHeight` | number, more than 0 | Height of the dimension text. |
| `arrowSize` | number, more than 0 | Length of the arrowheads. |
| `extGap` | number, 0 or more | Gap between the feature and the start of an extension line. |
| `extOver` | number, 0 or more | How far an extension line runs past the dimension line. |
| `textGap` | number, 0 or more | Gap between the dimension line and its text. |
| `precision` | whole number, 0–8 | Decimal places for lengths. |
| `anglePrecision` | whole number, 0–8 | Decimal places for angles, which are shown in degrees. |
| `centreMark` | number, more than 0 | Half-length of a centre mark's cross. |
| `centreOver` | number, 0 or more | How far the lines of an extended centre mark run past the circle. |

### Point references

Associative dimensions don't store the numbers they show. They store *where to measure*, and the
number is worked out from the geometry every time the drawing is read. A point is one of:

| `kind` | Other fields | Meaning |
|---|---|---|
| `"free"` | `p`: `{"x":…, "y":…}` | A fixed point that follows nothing. |
| `"end"` | `id`, `end`: `"start"` or `"end"` | An end of a segment or arc. |
| `"vertex"` | `id`, `index` | A vertex of a polyline (counting from 0). |
| `"mid"` | `id` | The midpoint of a segment. |
| `"center"` | `id` | The centre of a circle or arc. |

`id` must be an entity of the right kind. A point that is typed or clicked exactly on one of these
features is saved as a reference to it, so the dimension follows the feature when it moves. If
the entity a note refers to is deleted, the note is deleted with it; undo brings both back.

### Note bodies

`at` is the point the dimension line (or text) is placed through. It is a fixed position, so
moving only the geometry leaves the dimension line where it was.

| `kind` | Other fields | Meaning |
|---|---|---|
| `"linear"` | `orient` (`"horizontal"` or `"vertical"`), `a`, `b` (point references), `at`, `style` | The horizontal or vertical distance between `a` and `b`. |
| `"aligned"` | `a`, `b`, `at`, `style` | The distance from `a` to `b`, measured along the line between them. |
| `"radius"` | `target` (circle or arc id), `at`, `style` | Shows `R` and the radius. `at` says which way the dimension line points. |
| `"diameter"` | `target`, `at`, `style` | Shows `Ø` and the diameter. |
| `"angle"` | `vertex`, `a`, `b` (point references), `at`, `style` | The angle between the side from `vertex` through `a` and the side from `vertex` through `b`, in degrees. `at` sets the radius of the arc and which of the two angles is measured: the one `at` lies inside (so it can be more than 180°). |
| `"text"` | `at`, `height` (more than 0), `angle` (radians), `anchor` (`"left"`, `"center"` or `"right"`), `text` | Text. `text` is 1–2000 characters; `\n` starts a new line. |
| `"leader"` | `points` (2–50 points, no two in a row the same), `text` (0–2000 characters), `style` | An arrow at the first point, the line through the others, and the note at the last. |
| `"centre"` | `target` (circle or arc id), `extended` (`true` for centre lines, `false` for a cross), `style` | A centre mark. |
| `"hatch"` | `loops`, `pattern`, `spacing` (more than 0), `angle` (radians) | Fills a region. `loops` is a list of boundaries; each boundary is a list of 1–1000 entity ids that make a closed outline: one circle or closed polyline, or several lines, arcs and polylines that join end to end. The first boundary is the outside, and every other one is an island that stays clear. No entity may be used twice. `pattern` is `"solid"`, `"lines"`, `"cross"`, `"double"` or `"dots"`. |
| `"titleBlock"` | `at`, `size`, `fields` | A sheet border and title block with its lower left corner at `at`. `size` is `"A4"`, `"A3"`, `"A2"`, `"A1"` or `"A0"` (landscape, ISO 216). `fields` has `title`, `number`, `scale`, `revision`, `material`, `drawnBy`, `date` and `company`, each 0–200 characters of text. |

A note whose references can't be resolved (a missing entity, the wrong kind of entity, two
points that coincide, a hatch boundary that isn't closed) is refused when the file is opened, with
the location of the problem.

## Sheets

Named paper sheets. Geometry, notes, inserts and constraints live on one sheet; the view shows the
current sheet. Sheets are named like dimension styles, not ids.

| Field | Type | Meaning |
|---|---|---|
| `name` | text, 1–64 characters | Unique, ignoring upper/lower case. |
| `size` | `"A4"`, `"A3"`, `"A2"`, `"A1"` or `"A0"` | Landscape ISO 216 size. |

There is always at least one sheet. Objects with no `sheet` field belong to the first sheet in the
list.

## Blocks

A named definition in local coordinates. Inserting it places a copy in the drawing. There is no
nested block: explode an insert before putting it inside another block.

| Field | Type | Meaning |
|---|---|---|
| `name` | text, 1–64 characters | Unique, ignoring upper/lower case. |
| `members` | list of members | At least one, at most 500. Each has `geom` (a shape), `color`, `linetype` and `lineweight` (the same refs as an entity). Coordinates are relative to the insert base point. |

## Inserts

A placed copy of a block. Inserts share the id space with entities and notes.

| Field | Type | Meaning |
|---|---|---|
| `id` | whole number | Unique id. |
| `layer` | layer id | Must be an existing layer. |
| `z` | number | Drawing order, same rule as entities. |
| `color`, `linetype`, `lineweight` | same as an entity | Styles for the insert as a whole (`byLayer` stays `byLayer` on members). |
| `block` | block name | Must name one of `blocks`. |
| `at` | `{"x":…, "y":…}` | Where the block origin goes. |
| `rotation` | number | Radians, anticlockwise from +x. Omitted when 0. |
| `scale` | number, more than 0 | Omitted when 1. |
| `flipped` | `true` | Mirrors local x before rotate and scale. Omitted when false. |
| `sheet` | sheet name | Omitted when it is the first sheet. |

## Constraints

Relations that drive geometry. They are not measured dimensions: a distance constraint moves the
geometry, while a dimension note only displays a length. After every edit ArchiLite re-solves them
in id order until the residual stops shrinking. The same document always produces the same result.

A constraint's point references must name a point on a drawn shape, not a free point.

| Field | Type | Meaning |
|---|---|---|
| `id` | whole number | Unique id. |
| `body` | constraint body (below) | |
| `sheet` | sheet name | Omitted when it is the first sheet. |

| `kind` | Other fields | Meaning |
|---|---|---|
| `"coincident"` | `a`, `b` (point references) | The two points occupy the same place. |
| `"horizontal"` | `a`, `b` | The two points share a y. |
| `"vertical"` | `a`, `b` | The two points share an x. |
| `"distance"` | `a`, `b`, `value` (more than 0) | The distance between the two points. |
| `"fix"` | `a`, `p` | Point `a` stays at `p`. |
| `"midpoint"` | `a`, `of` (line id) | Point `a` stays at the middle of that line. |
| `"parallel"` | `a`, `b` (line ids) | The two lines stay parallel. |
| `"perpendicular"` | `a`, `b` | The two lines stay perpendicular. |
| `"equal"` | `a`, `b` | The two lines stay the same length. |
| `"concentric"` | `a`, `b` (circle or arc ids) | The two centres coincide. |
| `"tangent"` | `a`, `b` | A circle or arc tangent to a line, or two circles. |
| `"radius"` | `target` (circle or arc id), `value` (more than 0) | That radius. |
| `"length"` | `target` (line id), `value` (more than 0) | That length. |
| `"angle"` | `a`, `b` (line ids), `value` | The unsigned angle between the lines, in radians, strictly between 0 and π. |

A constraint whose geometry is gone is dropped in the same undo step as the edit.

## Styles

**Linetypes** are ArchiLite's own, using the element proportions of ISO 128-20 (lengths in multiples
of the line width *d*):

| Name | ISO 128 type | Pattern (dash, gap, …) | Typical use |
|---|---|---|---|
| `continuous` | 01 | solid | visible outlines |
| `dashed` | 02 | 12d, 3d | hidden detail |
| `dash-dot` | 04 | 24d, 3d, 0.5d, 3d | centre lines |
| `dash-double-dot` | 05 | 24d, 3d, 0.5d, 3d, 0.5d, 3d | phantom and adjacent parts |
| `dotted` | 07 | 0.5d, 3d | |

**Lineweights** are the ISO 128 series, in mm on paper: `0.13`, `0.18`, `0.25`, `0.35`, `0.5`, `0.7`,
`1`, `1.4`, `2`. They don't change with the drawing's units.

## Numbers

- Every number must be finite. `NaN` and `Infinity` can't be written in JSON. Values too large
  for a double, such as `1e999`, are refused rather than read as infinity.
- ArchiLite writes the shortest decimal that reads back to exactly the same value, so saving and
  loading never changes geometry.
- `-0` is stored as `0`.

## When a file is refused

The app and the file inspector report the first problem found, in plain words, with its location:

```text
Problem in the drawing file at entities[1].geom.radius: radius must be a positive finite number, got -4.
```

The location reads like a path: `entities[1]` is the second entity (counting from 0), `.geom.radius`
its radius. Notes, inserts and constraints read the same way.

## Versioning

- A change that older ArchiLite versions could misread raises `version`.
- ArchiLite opens files with its own version or lower, and refuses higher versions with a clear
  message rather than guessing.
