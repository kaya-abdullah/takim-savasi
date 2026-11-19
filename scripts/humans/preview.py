"""Blender: renders a front and a 3/4 close-up preview of an open .blend person. Args: -- <out_png_prefix>"""
import sys, bpy, math
from mathutils import Vector
out = sys.argv[sys.argv.index('--') + 1]
sc = bpy.context.scene
sc.render.engine = 'BLENDER_EEVEE'
sc.render.resolution_x, sc.render.resolution_y = 900, 1200
sc.world = bpy.data.worlds.new('w'); sc.world.use_nodes = True
sc.world.node_tree.nodes['Background'].inputs[0].default_value = (0.55, 0.62, 0.72, 1); sc.world.node_tree.nodes['Background'].inputs[1].default_value = 0.6
sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sun.data.energy = 4; sun.rotation_euler = (math.radians(50), 0, math.radians(35)); sc.collection.objects.link(sun)
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
sc.view_settings.view_transform = 'AgX'
for name, pos, tgt, lens in [('full', (1.6, -3.6, 1.1), (0, 0, 0.9), 50), ('face', (0.35, -0.85, 1.68), (0, 0, 1.62), 70)]:
    cam.location = Vector(pos); cam.data.lens = lens
    d = Vector(tgt) - cam.location
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = f'{out}-{name}.png'
    bpy.ops.render.render(write_still=True)
