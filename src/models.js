// GlTF autómodellek betöltése (public/models) + méret/orientáció normalizálás.
// Ha valamelyik fájl hiányzik vagy a hálózat le van, a játék a dobozos
// vészrájzolással is tökéletesen fut — a modellek csak díszítik a játékot.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { MODELS } from './constants.js';

const loader = new GLTFLoader();
// a ferrari.glb (és más, esetleg jövőbeli modellek) Draco-tömörítéssel készült;
// a dekódolót a public/draco/ mappába másoltuk (offline is megy)
const draco = new DRACOLoader();
draco.setDecoderPath('/draco/');
draco.setDecoderConfig({ type: 'js' });
loader.setDRACOLoader(draco);

// Az autót a kívánt hosszra méretezi, az orrát +Z felé fordítja (a glTF-konkvenció
// szerint előre = +Z), vízszintesen középre húzza, és az alját a talajszintre
// (a kerekek a 0-n állnak). A visszaadott Group közvetlenül beilleszthető.
function normalizeModel(scene, targetLen) {
  const g = new THREE.Group();
  g.add(scene.clone(true));
  const box = new THREE.Box3().setFromObject(g);
  const size = box.getSize(new THREE.Vector3());

  // ha a modell „nyugatról nézett” (az X a hosszabb vízszintes tengely), fordítsuk meg
  if (size.x > size.z) g.rotation.y = Math.PI / 2;

  box.setFromObject(g);
  const s = targetLen / Math.max(0.001, box.getSize(new THREE.Vector3()).z);
  g.scale.setScalar(s);

  box.setFromObject(g);
  const center = box.getCenter(new THREE.Vector3());
  g.position.set(-center.x, -box.min.y, -center.z);

  g.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return g;
}

export async function loadCarModels() {
  const [ferrari, sedan, truck] = await Promise.all([
    loader.loadAsync(MODELS.player),
    loader.loadAsync(MODELS.sedans[1]),
    loader.loadAsync(MODELS.truck),
  ]);
  return {
    player: normalizeModel(ferrari.scene, MODELS.playerLen),
    sedans: [
      normalizeModel(ferrari.scene, MODELS.carLen),
      normalizeModel(sedan.scene, MODELS.carLen),
    ],
    truck: normalizeModel(truck.scene, MODELS.truckLen),
  };
}
