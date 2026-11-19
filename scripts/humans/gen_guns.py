"""
Blender script: turns MakeHuman equipment guns (JALdMIC, CC-BY) into game weapon
models: long axis along +Z (muzzle forward), magazine and grip down (-Y in glTF),
bayonets removed, one textured material. Writes <out>/<id>.glb and prints the
muzzle-end length so the game can scale it.

Run: flatpak run --filesystem=... org.blender.Blender --background --python gen_guns.py -- <mpfb clothes dir> <out dir>
"""
import sys, os, bpy, bmesh
import numpy as np
from mathutils import Matrix, Vector

CLOTHES, OUT = sys.argv[sys.argv.index('--') + 1:]
os.makedirs(OUT, exist_ok=True)
GUNS = [  # game id, asset dir, obj, texture
    ('pistol', 'jaldmic_m1911a1', 'colt_m1911a1', 'colt_m1911a1.png'),
    ('rifle', 'jaldmic_akm_base', 'akm', 'akm.png'),
    ('sniper', 'jaldmic_l1a1', 'l1a1', 'l1a1.png'),
]


def frame(o):
    """Rotation that maps the gun's principal axes to (x: side, y: up, z: muzzle)."""
    P = np.array([o.matrix_world @ v.co for v in o.data.vertices])
    c = P.mean(0)
    Q = P - c
    w, V = np.linalg.eigh(np.cov(Q.T))
    ax = V[:, 2]  # longest
    up = V[:, 1]
    # muzzle: the end with the smaller cross-section
    t = Q @ ax
    L = t.max() - t.min()
    def spread(sel):
        R = Q[sel] - np.outer(Q[sel] @ ax, ax)
        return np.linalg.norm(R, axis=1).mean() if sel.any() else 0
    if spread(t > t.max() - 0.15 * L) > spread(t < t.min() + 0.15 * L):
        ax = -ax
    # down: grip and magazine hang below the bore, so most mass is on the down side
    s = Q @ up
    if np.mean(s ** 3) > 0:
        up = -up
    side = np.cross(up, ax)
    # a curved magazine skews the principal axis: turn about the side axis until the
    # front 40 % (barrel and handguard) is as flat as possible, i.e. the bore is level
    def rot(th):
        ct, st = np.cos(th), np.sin(th)
        return ct * ax + st * up, -st * ax + ct * up
    best = None
    for th in np.radians(np.arange(-70, 70.5, 0.5)):
        a2, u2 = rot(th)
        z, y = Q @ a2, Q @ u2
        front = z > z.min() + 0.6 * (z.max() - z.min())
        if front.sum() < 20:
            continue
        score = y[front].std()
        if best is None or score < best[0]:
            best = (score, a2, u2)
    _, ax, up = best
    z = Q @ ax
    Lz = z.max() - z.min()
    def spread2(sel):
        R = Q[sel] - np.outer(Q[sel] @ ax, ax)
        return np.linalg.norm(R, axis=1).mean() if sel.any() else 0
    if spread2(z > z.max() - 0.15 * Lz) > spread2(z < z.min() + 0.15 * Lz):
        ax, up = -ax, up
    if np.mean((Q @ up) ** 3) > 0:
        up = -up
    side = np.cross(up, ax)
    return c, Matrix([list(side), list(up), list(ax)])


for gid, d, objn, texn in GUNS:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.wm.obj_import(filepath=f'{CLOTHES}/{d}/{objn}.obj', forward_axis='NEGATIVE_Z', up_axis='Y')
    o = bpy.context.selected_objects[0]
    # bake the importer's object transform into the vertices first
    o.data.transform(o.matrix_world)
    o.matrix_world = Matrix.Identity(4)
    c, R = frame(o)
    # world -> gun frame (Blender object space, later exported y-up: our side/up/forward)
    o.data.transform(Matrix.Translation(-Vector(c)))
    o.data.transform(R.to_4x4())
    o.matrix_world = Matrix.Identity(4)
    # drop loose parts that sit entirely in the front 22 % (bayonets)
    bm = bmesh.new()
    bm.from_mesh(o.data)
    zs = [v.co.z for v in bm.verts]
    z0, z1 = min(zs), max(zs)
    seen, kill = set(), []
    for v in bm.verts:
        if v in seen:
            continue
        part, stack = [], [v]
        while stack:
            x = stack.pop()
            if x in seen:
                continue
            seen.add(x)
            part.append(x)
            stack.extend(e.other_vert(x) for e in x.link_edges)
        pz = [p.co.z for p in part]
        if min(pz) > z0 + 0.78 * (z1 - z0) or (max(pz) - min(pz) > 0.25 * (z1 - z0) and min(pz) > z0 + 0.6 * (z1 - z0)):
            kill.extend(part)
    bmesh.ops.delete(bm, geom=kill, context='VERTS')
    bm.to_mesh(o.data)
    bm.free()
    # phone budget: at most 8k triangles (4k for the pistol)
    budget = 4000 if gid == 'pistol' else 8000
    tris = sum(len(p.vertices) - 2 for p in o.data.polygons)
    if tris > budget:
        bpy.context.view_layer.objects.active = o
        dm = o.modifiers.new('dec', 'DECIMATE')
        dm.ratio = budget / tris
        bpy.ops.object.modifier_apply(modifier='dec')
    zs = [v.co.z for v in o.data.vertices]
    ys = [v.co.y for v in o.data.vertices]
    # put the butt at z = 0 and the bore line (top of the receiver area) near y = 0
    o.data.transform(Matrix.Translation(Vector((0, -np.percentile(ys, 75), -min(zs)))))
    zs = [v.co.z for v in o.data.vertices]
    m = bpy.data.materials.new(gid)
    m.use_nodes = True
    tn = m.node_tree.nodes.new('ShaderNodeTexImage')
    tn.image = bpy.data.images.load(f'{CLOTHES}/{d}/{texn}')
    bs = m.node_tree.nodes['Principled BSDF']
    m.node_tree.links.new(tn.outputs['Color'], bs.inputs['Base Color'])
    bs.inputs['Roughness'].default_value = 0.45
    bs.inputs['Metallic'].default_value = 0.5
    o.data.materials.clear()
    o.data.materials.append(m)
    o.name = gid
    # Blender is z-up; we built the gun with y up and z forward, so rotate into Blender space
    # (glTF export converts Blender (x, y, z) -> (x, z, -y); pre-rotate so glTF gets (side, up, forward))
    o.data.transform(Matrix.Rotation(np.pi / 2, 4, 'X'))
    path = f'{OUT}/{gid}.glb'
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_image_format='JPEG', export_jpeg_quality=85, export_yup=True)
    print('GUN', gid, 'length', round(max(zs) - min(zs), 3), 'tris', sum(len(p.vertices) - 2 for p in o.data.polygons), 'removed', len(kill), 'bytes', os.path.getsize(path))
