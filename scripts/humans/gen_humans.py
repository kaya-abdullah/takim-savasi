"""
Blender (5.x) + MPFB 2 script: builds the game's realistic people from MakeHuman
assets and exports one rigged .glb per character.

Run:  flatpak run --filesystem=<repo> org.blender.Blender --background \
        --python scripts/humans/gen_humans.py -- <out_dir> [name ...]

Every asset used is CC0 or CC-BY (see public/models/people/CREDITS.txt).
Rig: MPFB's "mixamo" rig, so the game's existing Mixamo retargeting drives it.
"""
import sys, os, bpy, bmesh
from mathutils import Vector
from bl_ext.user_default.mpfb.services.humanservice import HumanService
from bl_ext.user_default.mpfb.services.targetservice import TargetService

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else '/tmp/people'
ONLY = set(argv[1:])
os.makedirs(OUT, exist_ok=True)

# Civilian clothes, soldiers' bearing. Phenotype values are MakeHuman macros (0..1).
PEOPLE = [
    dict(name='p1', race=dict(caucasian=0.9, african=0.05, asian=0.05), age=0.5, muscle=0.65, weight=0.52, height=0.58, eyes='brownlight',
         skin='young_caucasian_male/young_caucasian_male.mhmat', hair='short02/short02.mhclo', eyebrows='eyebrow001/eyebrow001.mhclo',
         clothes=['male_casualsuit05/male_casualsuit05.mhclo', 'shoes02/shoes02.mhclo']),
    dict(name='p2', race=dict(caucasian=0.1, african=0.85, asian=0.05), age=0.5, muscle=0.7, weight=0.55, height=0.6, eyes='brown',
         skin='young_african_male/young_african_male.mhmat', hair='short01/short01.mhclo', eyebrows='eyebrow002/eyebrow002.mhclo',
         clothes=['toigo_basic_tucked_t-shirt/toigo_basic_tucked_t-shirt.mhclo', 'cortu_cargo_pants/cortu_cargo_pants.mhclo', 'shoes06/shoes06.mhclo']),
    dict(name='p3', race=dict(caucasian=0.55, african=0.05, asian=0.4), age=0.62, muscle=0.72, weight=0.55, height=0.62, eyes='grey',
         skin='young_asian_male/young_asian_male.mhmat', hair='short04/short04.mhclo', eyebrows='eyebrow003/eyebrow003.mhclo',
         clothes=['toigo_fisherman_sweater/toigo_fisherman_sweater.mhclo', 'cortu_cargo_pants/cortu_cargo_pants.mhclo', 'shoes03/shoes03.mhclo']),
    dict(name='p4', race=dict(caucasian=0.95, african=0.0, asian=0.05), age=0.62, muscle=0.6, weight=0.62, height=0.55, eyes='blue',
         skin='middleage_caucasian_male/middleage_caucasian_male.mhmat', hair='short03/short03.mhclo', eyebrows='eyebrow004/eyebrow004.mhclo',
         clothes=['namuhekam_male_polo_shirt/namuhekam_male_polo_shirt.mhclo', 'toigo_wool_pants/toigo_wool_pants.mhclo', 'shoes05/shoes05.mhclo'],
         beard='rehmanpolanski_beard_viking/rehmanpolanski_beard_viking.mhclo'),
    dict(name='p5', race=dict(caucasian=0.8, african=0.15, asian=0.05), age=0.45, muscle=0.75, weight=0.5, height=0.6, eyes='green',
         skin='young_caucasian_male2/young_caucasian_male2.mhmat', hair='short03/short03.mhclo', eyebrows='eyebrow005/eyebrow005.mhclo',
         clothes=['drednicolson_short-tail_camo_tee/drednicolson_short-tail_camo_tee.mhclo', 'cortu_cargo_pants/cortu_cargo_pants.mhclo', 'shoes02/shoes02.mhclo']),
    dict(name='p6', race=dict(caucasian=0.3, african=0.6, asian=0.1), age=0.58, muscle=0.65, weight=0.58, height=0.56, eyes='brown',
         skin='middleage_african_male/middleage_african_male.mhmat', hair='', eyebrows='eyebrow006/eyebrow006.mhclo',
         clothes=['male_casualsuit03/male_casualsuit03.mhclo', 'shoes06/shoes06.mhclo'], beard='wdg_scruffy_beard/wdg_scruffy_beard.mhclo'),
]

def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def build(p):
    info = HumanService._create_default_human_info_dict()
    ph = TargetService.get_default_macro_info_dict()
    ph.update(dict(gender=1.0, age=p['age'], muscle=p['muscle'], weight=p['weight'], height=p['height'], proportions=0.7))
    ph['race'] = p['race']
    info['phenotype'] = ph
    info['name'] = p['name']
    info['rig'] = 'mixamo'
    info['proxy'] = 'male1591/male1591.proxy'
    info['eyes'] = 'low-poly/low-poly.mhclo'
    info['eyebrows'] = p['eyebrows']
    info['eyelashes'] = 'eyelashes02/eyelashes02.mhclo'
    info['hair'] = p['hair']
    info['clothes'] = list(p['clothes']) + ([p['beard']] if p.get('beard') else [])
    info['skin_mhmat'] = p['skin']
    info['skin_material_type'] = 'MAKESKIN'
    info['eyes_material_type'] = 'MAKESKIN'
    info['clothes_material_type'] = 'MAKESKIN'
    st = HumanService.get_default_deserialization_settings()
    st['subdiv_levels'] = 0
    st['override_rig'] = 'PRESET'
    st['override_skin_model'] = 'PRESET'
    base = HumanService.deserialize_from_dict(info, st)
    return base


# ------------------------------------------------------------------ helpers
ALPHA_KINDS = ('eyebrow', 'eyelash', 'beard', 'moustache', 'hair')
DATA = None


def mesh_objects():
    return [o for o in bpy.data.objects if o.type == 'MESH']


def select_only(objs, active=None):
    bpy.ops.object.mode_set(mode='OBJECT') if bpy.context.object and bpy.context.object.mode != 'OBJECT' else None
    for o in bpy.data.objects:
        o.select_set(False)
    for o in objs:
        o.hide_set(False)
        o.select_set(True)
    bpy.context.view_layer.objects.active = active or objs[0]


def apply_non_armature_modifiers(o):
    if o.data.shape_keys:
        select_only([o])
        bpy.ops.object.shape_key_remove(all=True, apply_mix=True)
    for m in list(o.modifiers):
        if m.type == 'ARMATURE':
            continue
        select_only([o])
        bpy.ops.object.modifier_apply(modifier=m.name)


def swap_eye_colour(eyes, colour):
    from bl_ext.user_default.mpfb.services.locationservice import LocationService
    path = LocationService.get_user_data(f'eyes/materials/{colour}_eye.png')
    if not os.path.exists(path):
        return
    img = bpy.data.images.load(path)
    for s in eyes.material_slots:
        for n in s.material.node_tree.nodes:
            if n.type == 'TEX_IMAGE':
                n.image = img


def decimate(o, max_tris):
    tris = sum(len(p.vertices) - 2 for p in o.data.polygons)
    if tris > max_tris:
        select_only([o])
        m = o.modifiers.new('dec', 'DECIMATE')
        m.ratio = max_tris / tris
        bpy.ops.object.modifier_move_to_index(modifier='dec', index=0)
        bpy.ops.object.modifier_apply(modifier='dec')


def make_vest(proxy, rig):
    """A plate carrier cut from the fitted body proxy: torso band, pushed out over
    the clothes, given thickness, plus three magazine pouches on the chest.
    It keeps the proxy's bone weights, so it moves with the body."""
    v = proxy.copy()
    v.data = proxy.data.copy()
    v.name = 'vest'
    bpy.context.collection.objects.link(v)
    for m in list(v.modifiers):
        if m.type != 'ARMATURE':
            v.modifiers.remove(m)
    W = lambda b: rig.matrix_world @ rig.data.bones[b].head_local
    hips, neck = W('mixamorig:Hips'), W('mixamorig:Neck')
    z0, z1 = hips.z + 0.1, neck.z - 0.07
    bm = bmesh.new()
    bm.from_mesh(v.data)
    kill = []
    for vert in bm.verts:
        p = v.matrix_world @ vert.co
        t = (p.z - z0) / (z1 - z0)
        # torso half-width narrows towards the shoulders, so the A-posed arms stay out
        half = 0.205 - 0.035 * max(0.0, t)
        if not (z0 < p.z < z1) or abs(p.x - hips.x) > half:
            kill.append(vert)
    bmesh.ops.delete(bm, geom=kill, context='VERTS')
    bm.normal_update()
    # straight top and bottom hems instead of the proxy's triangle zigzag
    inv = v.matrix_world.inverted()
    for vert in bm.verts:
        if vert.is_boundary:
            p = v.matrix_world @ vert.co
            if p.z > (z0 + z1) / 2:
                p.z = max(p.z, z1 - 0.025) if abs(p.x - hips.x) > 0.06 else z1 - 0.06
            else:
                p.z = z0
            vert.co = inv @ p
    bm.normal_update()
    for vert in bm.verts:
        vert.co += vert.normal * 0.04
    bm.to_mesh(v.data)
    bm.free()
    v.data.materials.clear()
    mat = bpy.data.materials.new('vest')
    mat.use_nodes = True
    v.data.materials.append(mat)
    select_only([v])
    sol = v.modifiers.new('sol', 'SOLIDIFY')
    sol.thickness = 0.02
    sol.offset = 1
    bpy.ops.object.modifier_move_to_index(modifier='sol', index=0)
    bpy.ops.object.modifier_apply(modifier='sol')
    # chest pouches, weighted to the upper spine
    front_y = min((v.matrix_world @ p.co).y for p in v.data.vertices if abs((v.matrix_world @ p.co).x) < 0.08 and z0 + 0.15 < (v.matrix_world @ p.co).z < z1 - 0.1)
    pz = (z0 + z1) / 2 - 0.02
    g = v.vertex_groups.get('mixamorig:Spine2') or v.vertex_groups.new(name='mixamorig:Spine2')
    bm = bmesh.new()
    bm.from_mesh(v.data)
    new = []
    for px in (-0.085, 0.0, 0.085):
        r = bmesh.ops.create_cube(bm, size=1.0)
        for vert in r['verts']:
            vert.co.x = vert.co.x * 0.075 + px
            vert.co.y = vert.co.y * 0.035 + front_y - 0.016
            vert.co.z = vert.co.z * 0.13 + pz
            new.append(vert.index if vert.index >= 0 else None)
    bm.to_mesh(v.data)
    bm.free()
    n_old = len(v.data.vertices) - 24
    for i in range(n_old, len(v.data.vertices)):
        for gg in v.data.vertices[i].groups[:]:
            v.vertex_groups[gg.group].remove([i])
    g.add(list(range(n_old, len(v.data.vertices))), 1.0, 'REPLACE')
    select_only([v])
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(island_margin=0.02)
    bpy.ops.object.mode_set(mode='OBJECT')
    return v


def bake_atlas(objs, name, size, alpha, normal_size=0, prefix=''):
    """Joins objs into one mesh and bakes every material into one texture set
    on a fresh 'atlas' UV map. Islands are scaled by their 3D area; the face
    gets twice the texel density."""
    select_only(objs)
    bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    o.name = name
    src = o.data.uv_layers[0]
    src.name = 'src'
    at = o.data.uv_layers.new(name='atlas')
    o.data.uv_layers.active = at
    src.active_render = True
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.select_all(action='SELECT')
    bpy.ops.uv.average_islands_scale()
    bpy.ops.object.mode_set(mode='OBJECT')
    if not alpha:
        # the face gets twice the texel density: scale its UV islands up before packing
        # (packing keeps relative island sizes)
        head_z = max(v.co.z for v in o.data.vertices) - 0.3
        bpy.ops.object.mode_set(mode='EDIT')
        bm = bmesh.from_edit_mesh(o.data)
        uvl = bm.loops.layers.uv['atlas']
        for f in bm.faces:
            if f.calc_center_median().z > head_z:
                for l in f.loops:
                    l[uvl].uv *= 2.0
        bmesh.update_edit_mesh(o.data)
        bpy.ops.object.mode_set(mode='OBJECT')
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.select_all(action='SELECT')
    bpy.ops.uv.pack_islands(margin=0.004, rotate=True)
    bpy.ops.object.mode_set(mode='OBJECT')

    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = 1
    sc.cycles.device = 'CPU'
    sc.render.bake.margin = 4
    sc.render.bake.use_clear = True

    def target(img):
        for s in o.material_slots:
            nt = s.material.node_tree
            n = nt.nodes.get('__bake') or nt.nodes.new('ShaderNodeTexImage')
            n.name = '__bake'
            n.image = img
            nt.nodes.active = n

    col = bpy.data.images.new(prefix + name + '_col', size, size, alpha=alpha)
    target(col)
    sc.render.bake.use_pass_direct = False
    sc.render.bake.use_pass_indirect = False
    sc.render.bake.use_pass_color = True
    bpy.ops.object.bake(type='DIFFUSE')
    out = {'col': col}
    if alpha:
        # alpha: route each material's texture alpha into an emission shader, bake EMIT
        saved = []
        for s in o.material_slots:
            nt = s.material.node_tree
            bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
            link = bsdf.inputs['Alpha'].links[0] if bsdf.inputs['Alpha'].links else None
            em = nt.nodes.new('ShaderNodeEmission')
            if link:
                nt.links.new(link.from_socket, em.inputs['Color'])
            else:
                em.inputs['Color'].default_value = (1, 1, 1, 1)
            outn = next(n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL')
            old = outn.inputs['Surface'].links[0].from_socket
            nt.links.new(em.outputs[0], outn.inputs['Surface'])
            saved.append((nt, outn, old, em))
        a = bpy.data.images.new(name + '_a', size, size)
        target(a)
        bpy.ops.object.bake(type='EMIT')
        for nt, outn, old, em in saved:
            nt.links.new(old, outn.inputs['Surface'])
            nt.nodes.remove(em)
        px = list(col.pixels)
        ap = a.pixels[:]
        for i in range(0, len(px), 4):
            px[i + 3] = ap[i]
        col.pixels[:] = px
    if normal_size:
        nrm = bpy.data.images.new(prefix + name + '_nrm', normal_size, normal_size)
        nrm.colorspace_settings.name = 'Non-Color'
        target(nrm)
        bpy.ops.object.bake(type='NORMAL', normal_space='TANGENT')
        out['nrm'] = nrm
    # replace all materials with one material using the baked textures
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes['Principled BSDF']
    t = nt.nodes.new('ShaderNodeTexImage')
    t.image = col
    nt.links.new(t.outputs['Color'], bsdf.inputs['Base Color'])
    if alpha:
        nt.links.new(t.outputs['Alpha'], bsdf.inputs['Alpha'])
    if 'nrm' in out:
        tn = nt.nodes.new('ShaderNodeTexImage')
        tn.image = out['nrm']
        nm = nt.nodes.new('ShaderNodeNormalMap')
        nt.links.new(tn.outputs['Color'], nm.inputs['Color'])
        nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    bsdf.inputs['Roughness'].default_value = 0.7
    o.data.materials.clear()
    o.data.materials.append(mat)
    o.data.uv_layers.remove(o.data.uv_layers['src'])
    o.data.uv_layers['atlas'].name = 'UVMap'
    for img in [col] + ([out['nrm']] if 'nrm' in out else []):
        img.file_format = 'PNG'
        img.filepath_raw = os.path.join(OUT, img.name + '.png')
        img.save()
    return o


def export(p):
    rig = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
    base = next(o for o in mesh_objects() if o.name.endswith('.body'))
    proxy = next(o for o in mesh_objects() if 'male1591' in o.name)
    eyes = next(o for o in mesh_objects() if o.name.endswith('low-poly'))
    swap_eye_colour(eyes, p['eyes'])
    bpy.data.objects.remove(base)
    # cut the vest from the full proxy, before the clothes' delete-masks remove the torso
    vest = make_vest(proxy, rig)
    for o in mesh_objects():
        apply_non_armature_modifiers(o)
        decimate(o, 6000)
    parts = [o for o in mesh_objects() if o is not vest]
    hair_stem = os.path.basename(p['hair']).split('.')[0].lower() if p['hair'] else '\0'
    alpha = [o for o in parts if any(k in o.name.lower() for k in ALPHA_KINDS) or hair_stem in o.name.lower()]
    opaque = [o for o in parts if o not in alpha]
    bake_atlas(opaque, 'skin', 1024, False, normal_size=512, prefix=p['name'] + '_')
    if alpha:
        bake_atlas(alpha, 'hair', 512, True, prefix=p['name'] + '_')
    select_only([rig] + mesh_objects(), rig)
    tris = sum(sum(len(pl.vertices) - 2 for pl in o.data.polygons) for o in mesh_objects())
    path = os.path.join(OUT, p['name'] + '.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_skins=True,
                              export_animations=False, export_morph=False, export_apply=False,
                              export_image_format='JPEG', export_jpeg_quality=88, export_yup=True)
    print('PERSON', p['name'], 'tris', tris, 'objects', [o.name for o in mesh_objects()], 'bytes', os.path.getsize(path))


for p in PEOPLE:
    if ONLY and p['name'] not in ONLY:
        continue
    clear()
    build(p)
    export(p)
