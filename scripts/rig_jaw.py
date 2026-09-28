"""
Add a talking jaw to griffin.glb:
  1. cut a slit along the painted lip line so the mouth can open
  2. add mixamorig:Jaw (child of Head) and skin chin / lower lip / jaw to it
  3. add a dark mouth cavity + PS1-style teeth (top on Head, bottom on Jaw)
  4. re-export with every animation intact
Usage: blender -b --python rig_jaw.py -- <in.glb> <out.glb> <preview_dir>
"""
import bpy, bmesh, mathutils, sys, math
args = sys.argv[sys.argv.index("--")+1:]
SRC, DST, PREV = args
V = mathutils.Vector

bpy.ops.wm.read_factory_settings(use_empty=True)
scn = bpy.context.scene
scn.render.fps = 30          # keep glTF key times on whole frames (no resampling drift)
bpy.ops.import_scene.gltf(filepath=SRC)
arm  = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
body = bpy.data.objects["BaseMeshBKP"]
print("ACTIONS_IN", len(bpy.data.actions), sorted(a.name for a in bpy.data.actions))

# Work in rest pose, no action applied
arm.animation_data.action = None if arm.animation_data else None
for pb in arm.pose.bones: pb.location = (0,0,0); pb.rotation_quaternion = (1,0,0,0); pb.scale = (1,1,1)
bpy.context.view_layer.update()

LIP_Z   = 1.0775     # painted lip line (world, rest pose)
MOUTH_W = 0.021      # half-width of the mouth opening
PIVOT   = V((0.0, 0.034, 1.097))   # jaw hinge: just in front of / below the ears
CHIN    = V((0.0, -0.012, 1.036))

bw = body.matrix_world; bwi = bw.inverted()

# ── 1. slit along the lip line ──────────────────────────────────────────────
me = body.data
bm = bmesh.new(); bm.from_mesh(me)
bm.verts.ensure_lookup_table(); bm.faces.ensure_lookup_table()
def wpos(v): return bw @ v.co
cand = [f for f in bm.faces
        if all(abs(wpos(v).x) < 0.045 and 1.055 < wpos(v).z < 1.095 and wpos(v).y < 0.012 for v in f.verts)]
plane_co = bwi @ V((0, 0, LIP_Z))
plane_no = (bwi.to_3x3() @ V((0, 0, 1))).normalized()
geom = list(set(e for f in cand for e in f.edges)) + cand + list(set(v for f in cand for v in f.verts))
res = bmesh.ops.bisect_plane(bm, geom=geom, plane_co=plane_co, plane_no=plane_no, dist=1e-5)
cut_edges = [e for e in res["geom_cut"] if isinstance(e, bmesh.types.BMEdge)]
slit = [e for e in cut_edges if all(abs(wpos(v).x) <= MOUTH_W + 1e-4 for v in e.verts)]
print("SLIT_EDGES", len(slit), "of", len(cut_edges), "cut edges; faces", len(cand))
# One extra cut per slit edge → a lower lip of 3 moving verts, so it opens like a mouth, not a pinhole
bmesh.ops.subdivide_edges(bm, edges=slit, cuts=1, use_grid_fill=False)
bm.edges.ensure_lookup_table()
slit = [e for e in bm.edges
        if all(abs(wpos(v).z - LIP_Z) < 2e-4 and abs(wpos(v).x) <= MOUTH_W + 2e-3 for v in e.verts)]
print("SLIT_EDGES_SUBDIVIDED", len(slit))
# Split so upper and lower lip become separate edges (keeps the two mouth-corner verts shared)
split = bmesh.ops.split_edges(bm, edges=slit)
bm.verts.ensure_lookup_table()
# Lower-lip verts = slit verts whose faces lie below the lip line
lower_lip = set()
for e in split["edges"]:
    for v in e.verts:
        if abs(wpos(v).z - LIP_Z) < 1e-3 and abs(wpos(v).x) < MOUTH_W - 1e-3:
            below = [f for f in v.link_faces if (bw @ f.calc_center_median()).z < LIP_Z]
            if below and len(below) == len(v.link_faces): lower_lip.add(v.index)
bm.to_mesh(me); bm.free(); me.update()
print("LOWER_LIP_VERTS", len(lower_lip))

# ── 2. jaw bone ─────────────────────────────────────────────────────────────
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='EDIT')
aw = arm.matrix_world; awi = aw.inverted()
eb = arm.data.edit_bones
head_eb = eb["mixamorig:Head"]
jaw = eb.new("mixamorig:Jaw")
jaw.head = awi @ PIVOT
jaw.tail = awi @ CHIN
jaw.roll = 0
jaw.parent = head_eb
jaw.use_deform = True
bpy.ops.object.mode_set(mode='OBJECT')

# ── weights: chin / lower lip / jaw line → Jaw ─────────────────────────────
def smooth(t): t = max(0.0, min(1.0, t)); return t * t * (3 - 2 * t)
gh = body.vertex_groups["mixamorig:Head"]
gn = body.vertex_groups.get("mixamorig:Neck")
gj = body.vertex_groups.new(name="mixamorig:Jaw")
moved = 0
for v in me.vertices:
    p = bw @ v.co
    wh = next((g.weight for g in v.groups if g.group == gh.index), 0.0)
    if wh <= 0: continue
    if v.index in lower_lip: w = 1.0
    else:
        below = smooth((LIP_Z - p.z) / 0.012)                     # under the lip line
        front = smooth((0.050 - p.y) / 0.040)                     # towards the face, fading to the ear
        side  = smooth((0.080 - abs(p.x)) / 0.030)                # fades out past the cheeks
        w = below * front * side
    w = min(w, 1.0) * wh
    if w > 0.01:
        gj.add([v.index], w, 'REPLACE')
        gh.add([v.index], max(0.0, wh - w), 'REPLACE')
        moved += 1
print("JAW_WEIGHTED_VERTS", moved)

# ── 3. mouth cavity + teeth (separate skinned mesh) ────────────────────────
def add_box(bm, center, size):
    r = bmesh.ops.create_cube(bm, size=1.0)
    for vv in r["verts"]:
        vv.co = V((vv.co.x * size[0], vv.co.y * size[1], vv.co.z * size[2])) + center
    return r["verts"]
mouth_me = bpy.data.meshes.new("GriffinMouth"); mbm = bmesh.new()
cav_top = add_box(mbm, V((0, 0.006, LIP_Z + 0.003)), (0.040, 0.024, 0.008))
cav_bot = add_box(mbm, V((0, 0.006, LIP_Z - 0.007)), (0.040, 0.024, 0.012))
tee_top = add_box(mbm, V((0, -0.003, LIP_Z + 0.0015)), (0.024, 0.004, 0.004))
tee_bot = add_box(mbm, V((0, -0.002, LIP_Z - 0.0035)), (0.022, 0.004, 0.004))
mbm.to_mesh(mouth_me); mbm.free()
mouth = bpy.data.objects.new("GriffinMouth", mouth_me)
scn.collection.objects.link(mouth)
dark = bpy.data.materials.new("MouthDark");  dark.diffuse_color = (0.12, 0.02, 0.02, 1)
teeth = bpy.data.materials.new("MouthTeeth"); teeth.diffuse_color = (0.85, 0.82, 0.72, 1)
for m in (dark, teeth):
    m.use_nodes = True
    m.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = m.diffuse_color
    m.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.8
mouth_me.materials.append(dark); mouth_me.materials.append(teeth)
for i, poly in enumerate(mouth_me.polygons): poly.material_index = 0 if i < 12 else 1
# skin: top half → Head, bottom half → Jaw
vh = mouth.vertex_groups.new(name="mixamorig:Head"); vj = mouth.vertex_groups.new(name="mixamorig:Jaw")
for v in mouth_me.vertices:
    (vh if v.co.z >= LIP_Z - 0.0005 else vj).add([v.index], 1.0, 'REPLACE')
mouth.parent = arm
mouth.matrix_parent_inverse = arm.matrix_world.inverted()
mod = mouth.modifiers.new("Armature", 'ARMATURE'); mod.object = arm

# ── preview renders: closed + jaw open ─────────────────────────────────────
scn.render.engine = 'BLENDER_WORKBENCH'; scn.display.shading.light = 'FLAT'; scn.display.shading.color_type = 'TEXTURE'
scn.render.resolution_x = scn.render.resolution_y = 600
cd = bpy.data.cameras.new("pc"); cd.type = 'ORTHO'; cd.ortho_scale = 0.2
cam = bpy.data.objects.new("pc", cd); scn.collection.objects.link(cam); scn.camera = cam
def shot(name, dirv, open_deg):
    pb = arm.pose.bones["mixamorig:Jaw"]; pb.rotation_mode = 'XYZ'; pb.rotation_euler = (math.radians(open_deg), 0, 0)
    bpy.context.view_layer.update()
    c = V((0, 0.03, 1.09)); cam.location = c + V(dirv) * 2
    cam.rotation_euler = (-V(dirv)).to_track_quat('-Z', 'Y').to_euler()
    scn.render.filepath = f"{PREV}/{name}.png"; bpy.ops.render.render(write_still=True)
shot("closed_front", (0, -1, 0), 0)
shot("open_front", (0, -1, 0), 18)
shot("open_neg_front", (0, -1, 0), -18)
shot("open_side", (1, -0.35, 0.1), 18)
arm.pose.bones["mixamorig:Jaw"].rotation_euler = (0, 0, 0)
bpy.context.view_layer.update()

# ── 4. export ──────────────────────────────────────────────────────────────
bpy.ops.object.select_all(action='DESELECT')
bpy.ops.export_scene.gltf(filepath=DST, export_format='GLB', export_animations=True,
                          export_animation_mode='ACTIONS', export_skins=True, export_morph=True,
                          export_apply=False, export_yup=True)
print("EXPORTED", DST)
