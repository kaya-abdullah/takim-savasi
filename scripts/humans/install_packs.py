# Blender script: installs every complete MakeHuman asset pack zip given on the command line into MPFB's user data.
import sys, zipfile
from bl_ext.user_default.mpfb.services.assetservice import AssetService
from bl_ext.user_default.mpfb.services.locationservice import LocationService
target = LocationService.get_user_data()
for f in sys.argv[sys.argv.index('--') + 1:]:
    try:
        zipfile.ZipFile(f).testzip()
    except Exception:
        print('SKIP (incomplete)', f); continue
    print('INSTALL', f, AssetService.fix_and_extract_asset_pack_zip(f, target))
print('USERDATA', target)
