import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

// Scene
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x33334e);

// Camera
const canvas = document.getElementById('canvas');
const camera = new THREE.PerspectiveCamera(45, canvas.clientWidth / canvas.clientHeight, 0.1, 1000);
camera.position.set(-0.3, 0.3, 0.5);

// Renderer
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(canvas.clientWidth, canvas.clientHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.BasicShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;

// Controls
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

// Post Processing
const composer = new EffectComposer(renderer);


const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);

// Color Correction Shader
const ColorCorrectionShader = {
  uniforms: {
    tDiffuse: { value: null },
    saturation: { value: 0.0 },
    contrast: { value: 0.0 },
    brightness: { value: 0.0 }
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float saturation;
    uniform float contrast;
    uniform float brightness;
    varying vec2 vUv;
    
    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);
      
      // Brightness (additive)
      texel.rgb += brightness;
      
      // Contrast (centered at 0)
      texel.rgb = (texel.rgb - 0.5) * (1.0 + contrast) + 0.5;
      
      // Saturation (centered at 0)
      float luma = dot(texel.rgb, vec3(0.299, 0.587, 0.114));
      texel.rgb = mix(vec3(luma), texel.rgb, 1.0 + saturation);
      
      gl_FragColor = texel;
    }
  `
};

// Bloom Pass (Must be BEFORE Tone Mapping/Output)
const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(canvas.clientWidth, canvas.clientHeight),
  0.5,  // strength
  0.5,  // radius
  0.8   // threshold
);
bloomPass.enabled = false;
composer.addPass(bloomPass);

// Color Correction
const colorPass = new ShaderPass(ColorCorrectionShader);
composer.addPass(colorPass);
colorPass.enabled = false;

// Output Pass (Must be LAST to handle Tone Mapping & sRGB)
const outputPass = new OutputPass();
composer.addPass(outputPass);

// Lights
const ambientLight = new THREE.AmbientLight(0xffffff, 1);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 1);
// Light position will be controlled by direction/elevation sliders
const lightDistance = 10;
dirLight.position.set(5, 10, 5);
dirLight.castShadow = true;
dirLight.shadow.mapSize.width = 2048;
dirLight.shadow.mapSize.height = 2048;
dirLight.shadow.bias = -0.0001;
dirLight.shadow.normalBias = 0.05;
dirLight.shadow.radius = 1;
dirLight.shadow.camera.near = 0.1;
dirLight.shadow.camera.far = 50;
dirLight.shadow.camera.left = -10;
dirLight.shadow.camera.right = 10;
dirLight.shadow.camera.top = 10;
dirLight.shadow.camera.bottom = -10;
scene.add(dirLight);

// HDR Environment
let envMap = null;
let currentHdrName = 'klippad_sunrise_2_1k.hdr';

function loadHDR(url, filename) {
  new RGBELoader().load(url, (hdr) => {
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    scene.environment = hdr;
    envMap = hdr;
    
    // Apply current intensity and rotation
    const intensitySlider = document.getElementById('hdr-intensity');
    const rotationSlider = document.getElementById('hdr-rotation');
    if (intensitySlider) scene.environmentIntensity = parseFloat(intensitySlider.value);
    if (rotationSlider) scene.environmentRotation.y = parseFloat(rotationSlider.value) * Math.PI / 180;
    
    // Update filename display
    if (filename) {
      currentHdrName = filename;
      document.getElementById('hdr-filename').textContent = filename;
    }
  });
}

// Load default HDR
loadHDR('/img/klippad_sunrise_2_1k.hdr', 'klippad_sunrise_2_1k.hdr');

// HDR file upload
document.getElementById('btn-load-hdr').addEventListener('click', () => {
  document.getElementById('hdr-file-input').click();
});

document.getElementById('hdr-file-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  
  const url = URL.createObjectURL(file);
  loadHDR(url, file.name);
  e.target.value = '';
});

// Stats tracking
const stats = {
  triangles: 0,
  materials: new Set(),
  textures: new Set(),
  textureSize: 0
};

// Load Model Logic
const loader = new GLTFLoader();

function onModelLoaded(gltf) {
  const model = gltf.scene;
  
  // Enable shadows and gather stats
  model.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
      
      if (child.geometry.index) {
        stats.triangles += child.geometry.index.count / 3;
      } else if (child.geometry.attributes.position) {
        stats.triangles += child.geometry.attributes.position.count / 3;
      }
      
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      mats.forEach(mat => {
        stats.materials.add(mat);
        ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap'].forEach(prop => {
          if (mat[prop]) {
            stats.textures.add(mat[prop]);
            if (mat[prop].image) {
              const img = mat[prop].image;
              stats.textureSize += (img.width * img.height * 4) / (1024 * 1024);
            }
          }
        });
      });
    }
  });
  
  scene.add(model);
  
  // Update UI
  buildSceneTree();
  buildMaterialList();
  updateStats();
}

// 1. Load Default Models (Auto-named)
function loadModel(path) {
  loader.load(path, (gltf) => {
    gltf.scene.name = path.split('/').pop();
    onModelLoaded(gltf);
  });
}

loadModel('/models/DiriyahMaquette.glb');
loadModel('/models/DiriyahMaquetteFoliage.glb');


// 2. Setup GLB Import Button
document.getElementById('btn-import-glb').addEventListener('click', () => {
  document.getElementById('glb-file-input').click();
});

document.getElementById('glb-file-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  
  const url = URL.createObjectURL(file);
  loader.load(url, (gltf) => {
    onModelLoaded(gltf);
    URL.revokeObjectURL(url); // Clean up memory
  }, undefined, (err) => {
    alert('Error loading GLB: ' + err.message);
  });
  
  e.target.value = ''; // Reset input
});

// Build Scene Tree
function buildSceneTree() {
  const container = document.getElementById('scene-tree');
  container.innerHTML = '';
  
  function addNode(object, depth = 0) {
    const wrapper = document.createElement('div');
    
    const div = document.createElement('div');
    div.className = 'tree-item';
    if (object.isMesh) div.classList.add('mesh');
    else if (object.isGroup || object.isObject3D) div.classList.add('group');
    else if (object.isLight) div.classList.add('light');
    
    div.style.paddingLeft = (10 + depth * 12) + 'px';
    
    const hasChildren = object.children.length > 0;
    const toggle = document.createElement('span');
    toggle.className = 'tree-toggle';
    toggle.textContent = hasChildren ? '▼' : ' ';
    div.appendChild(toggle);
    
    const name = document.createElement('span');
    name.textContent = ' ' + (object.name || object.type);
    div.appendChild(name);
    
    wrapper.appendChild(div);
    
    if (hasChildren) {
      const childrenDiv = document.createElement('div');
      childrenDiv.className = 'tree-children';
      
      object.children.forEach(child => {
        childrenDiv.appendChild(addNode(child, depth + 1));
      });
      
      wrapper.appendChild(childrenDiv);
      
      // LOGIC: Collapse if this group only contains Meshes (no other Groups inside)
      // This keeps the hierarchy open but hides the list of raw geometry elements
      const hasGroupChildren = object.children.some(c => !c.isMesh && !c.isLight);
      const startCollapsed = !hasGroupChildren;

      if (startCollapsed) {
        childrenDiv.classList.add('collapsed');
      }

      // Set initial arrow icon
      toggle.textContent = startCollapsed ? '▶' : '▼';
      
      toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const isCollapsed = childrenDiv.classList.toggle('collapsed');
        toggle.textContent = isCollapsed ? '▶' : '▼';
      });
    }
    
    return wrapper;
  }
  
  scene.children.forEach(child => {
    container.appendChild(addNode(child));
  });
}

// Selected material reference
let selectedMaterial = null;

// Calculate material texture size in MB
function getMaterialSize(mat) {
  let size = 0;
  ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap'].forEach(prop => {
    if (mat[prop] && mat[prop].image) {
      const img = mat[prop].image;
      size += (img.width * img.height * 4) / (1024 * 1024);
    }
  });
  return size;
}

// Build Material List
function buildMaterialList() {
  const container = document.getElementById('material-list');
  container.innerHTML = '';
  
  stats.materials.forEach(mat => {
    const div = document.createElement('div');
    div.className = 'material-item';
    
    const swatch = document.createElement('div');
    swatch.className = 'material-swatch';
    if (mat.color) {
      swatch.style.background = '#' + mat.color.getHexString();
    }
    
    const name = document.createElement('span');
    name.className = 'material-name';
    name.textContent = mat.name || 'Unnamed Material';
    
    const size = document.createElement('span');
    size.className = 'material-size';
    const sizeMB = getMaterialSize(mat);
    size.textContent = sizeMB > 0 ? sizeMB.toFixed(1) + ' MB' : '';
    
    div.appendChild(swatch);
    div.appendChild(name);
    div.appendChild(size);
    container.appendChild(div);
    
    // Click to select material
    div.addEventListener('click', () => {
      // Remove previous selection
      container.querySelectorAll('.material-item').forEach(el => el.classList.remove('selected'));
      div.classList.add('selected');
      selectedMaterial = mat;
      updateMaterialInspector(mat);
    });
  });
}

// Update Material Inspector
function updateMaterialInspector(mat) {
  const content = document.getElementById('material-inspector-content');
  content.innerHTML = '';
  
  if (!mat) {
    content.innerHTML = '<div class="inspector-empty">Select a material</div>';
    return;
  }
  
  // Helper to create a row
  function createRow(label, value, colorHex, texture) {
    const row = document.createElement('div');
    row.className = 'inspector-row';
    
    const labelEl = document.createElement('span');
    labelEl.className = 'label';
    labelEl.textContent = label;
    row.appendChild(labelEl);
    
    if (colorHex) {
      const colorPreview = document.createElement('div');
      colorPreview.className = 'color-preview';
      colorPreview.style.background = colorHex;
      row.appendChild(colorPreview);
    }
    
    const valueEl = document.createElement('span');
    valueEl.className = 'value';
    
    if (texture) {
      valueEl.className = 'value texture-link';
      valueEl.textContent = texture.name || 'Texture';
      valueEl.addEventListener('click', () => {
        showTextureInspector(texture);
      });
    } else {
      valueEl.textContent = value;
    }
    
    row.appendChild(valueEl);
    return row;
  }
  
  // Base Color
  if (mat.map) {
    content.appendChild(createRow('Base Color', null, null, mat.map));
  } else if (mat.color) {
    const hex = '#' + mat.color.getHexString();
    content.appendChild(createRow('Base Color', hex, hex, null));
  } else {
    content.appendChild(createRow('Base Color', 'N/A', null, null));
  }
  
  // Roughness
  if (mat.roughnessMap) {
    content.appendChild(createRow('Roughness', null, null, mat.roughnessMap));
  } else if (mat.roughness !== undefined) {
    content.appendChild(createRow('Roughness', mat.roughness.toFixed(2), null, null));
  }
  
  // Metalness
  if (mat.metalnessMap) {
    content.appendChild(createRow('Metalness', null, null, mat.metalnessMap));
  } else if (mat.metalness !== undefined) {
    content.appendChild(createRow('Metalness', mat.metalness.toFixed(2), null, null));
  }
  
  // Emissive
  if (mat.emissiveMap) {
    content.appendChild(createRow('Emissive', null, null, mat.emissiveMap));
  } else if (mat.emissive) {
    const hex = '#' + mat.emissive.getHexString();
    const intensity = mat.emissiveIntensity !== undefined ? mat.emissiveIntensity : 1;
    content.appendChild(createRow('Emissive', `${hex} (${intensity.toFixed(2)})`, hex, null));
  }
  
  // Opacity
  if (mat.alphaMap) {
    content.appendChild(createRow('Opacity', null, null, mat.alphaMap));
  } else if (mat.opacity !== undefined) {
    content.appendChild(createRow('Opacity', mat.opacity.toFixed(2), null, null));
  }
  
  // Normal Map (bonus)
  if (mat.normalMap) {
    content.appendChild(createRow('Normal', null, null, mat.normalMap));
  }
  
  // AO Map (bonus)
  if (mat.aoMap) {
    content.appendChild(createRow('AO', null, null, mat.aoMap));
  }
}

// Show Texture in Inspector
function showTextureInspector(texture) {
  const content = document.getElementById('texture-inspector-content');
  content.innerHTML = '';
  
  if (!texture || !texture.image) {
    return;
  }
  
  const img = document.createElement('img');
  
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    if (texture.image instanceof ImageBitmap) {
      canvas.width = texture.image.width;
      canvas.height = texture.image.height;
      ctx.drawImage(texture.image, 0, 0);
      img.src = canvas.toDataURL();
    } else if (texture.image instanceof HTMLImageElement) {
      canvas.width = texture.image.naturalWidth || texture.image.width;
      canvas.height = texture.image.naturalHeight || texture.image.height;
      ctx.drawImage(texture.image, 0, 0);
      img.src = canvas.toDataURL();
    } else if (texture.image instanceof HTMLCanvasElement) {
      img.src = texture.image.toDataURL();
    } else if (texture.image.data && texture.image.width && texture.image.height) {
      canvas.width = texture.image.width;
      canvas.height = texture.image.height;
      const imageData = ctx.createImageData(texture.image.width, texture.image.height);
      imageData.data.set(texture.image.data);
      ctx.putImageData(imageData, 0, 0);
      img.src = canvas.toDataURL();
    }
    
    content.appendChild(img);
  } catch (e) {
    console.warn('Could not preview texture:', e);
  }
}

// Update Stats Panel
function updateStats() {
  document.getElementById('stat-triangles').textContent = Math.round(stats.triangles).toLocaleString();
  document.getElementById('stat-materials').textContent = stats.materials.size;
  document.getElementById('stat-textures').textContent = stats.textures.size;
  document.getElementById('stat-texture-size').textContent = stats.textureSize.toFixed(2);
  document.getElementById('stat-drawcalls').textContent = renderer.info.render.calls;
  document.getElementById('stat-geometries').textContent = renderer.info.memory.geometries;
}

// Tab Navigation
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.menu').forEach(m => m.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(tab.dataset.tab + '-menu').classList.add('active');
  });
});

// Slider Helper
function setupSlider(id, callback) {
  const slider = document.getElementById(id);
  if (!slider) return;
  const value = slider.nextElementSibling;
  slider.addEventListener('input', () => {
    const v = parseFloat(slider.value);
    if (value) {
      if (id === 'hdr-rotation' || id === 'dir-direction' || id === 'dir-elevation') value.textContent = v + '°';
      else if (id === 'shadow-bias') value.textContent = v.toFixed(4);
      else value.textContent = v.toFixed(2);
    }
    callback(v);
  });
}

// Camera Controls
setupSlider('camera-fov', (v) => {
  camera.fov = v;
  camera.updateProjectionMatrix();
  document.getElementById('camera-fov').nextElementSibling.textContent = v + '°';
});

// Lighting Controls
setupSlider('hdr-intensity', (v) => {
  if (envMap) scene.environmentIntensity = v;
});

setupSlider('hdr-rotation', (v) => {
  if (envMap) scene.environmentRotation.y = v * Math.PI / 180;
});

document.getElementById('hdr-background').addEventListener('change', (e) => {
  if (e.target.checked && envMap) {
    scene.background = envMap;
  } else {
    scene.background = new THREE.Color(0x33334e);
  }
});

document.getElementById('ambient-color').addEventListener('input', (e) => {
  ambientLight.color.set(e.target.value);
});

setupSlider('ambient-intensity', (v) => ambientLight.intensity = v);

document.getElementById('dir-color').addEventListener('input', (e) => {
  dirLight.color.set(e.target.value);
});
setupSlider('dir-intensity', (v) => dirLight.intensity = v);

function updateLightPosition() {
  const dirSlider = document.getElementById('dir-direction');
  const elevSlider = document.getElementById('dir-elevation');
  
  const direction = parseFloat(dirSlider.value) * Math.PI / 180;
  const elevation = parseFloat(elevSlider.value) * Math.PI / 180;
  
  const distance = 10;
  dirLight.position.x = Math.sin(direction) * Math.cos(elevation) * distance;
  dirLight.position.y = Math.sin(elevation) * distance;
  dirLight.position.z = Math.cos(direction) * Math.cos(elevation) * distance;
}

setupSlider('dir-direction', (v) => {
  document.getElementById('dir-direction').nextElementSibling.textContent = v + '°';
  updateLightPosition();
});

setupSlider('dir-elevation', (v) => {
  document.getElementById('dir-elevation').nextElementSibling.textContent = v + '°';
  updateLightPosition();
});

// Initialize light position
updateLightPosition();

const shadowCheckbox = document.getElementById('shadows-enabled');
if (shadowCheckbox) {
  shadowCheckbox.addEventListener('change', (e) => {
    renderer.shadowMap.enabled = e.target.checked;
    dirLight.castShadow = e.target.checked;
  });
}

document.getElementById('shadow-type').addEventListener('change', (e) => {
  const type = parseInt(e.target.value);
  switch(type) {
    case 0: renderer.shadowMap.type = THREE.BasicShadowMap; break;
    case 1: renderer.shadowMap.type = THREE.PCFShadowMap; break;
    case 2: renderer.shadowMap.type = THREE.PCFSoftShadowMap; break;
    case 3: renderer.shadowMap.type = THREE.VSMShadowMap; break;
  }
  // Dispose old shadow map
  dirLight.shadow.map?.dispose();
  dirLight.shadow.map = null;
  
  // Toggle shadow map to force rebuild
  renderer.shadowMap.enabled = false;
  renderer.shadowMap.enabled = true;
});

setupSlider('shadow-bias', (v) => dirLight.shadow.bias = v);

setupSlider('shadow-normal-bias', (v) => dirLight.shadow.normalBias = v);

document.getElementById('shadow-map-size').addEventListener('change', (e) => {
  const size = parseInt(e.target.value);
  dirLight.shadow.mapSize.width = size;
  dirLight.shadow.mapSize.height = size;
  dirLight.shadow.map?.dispose();
  dirLight.shadow.map = null;
});

setupSlider('shadow-radius', (v) => dirLight.shadow.radius = v);

setupSlider('shadow-camera-size', (v) => {
  dirLight.shadow.camera.left = -v;
  dirLight.shadow.camera.right = v;
  dirLight.shadow.camera.top = v;
  dirLight.shadow.camera.bottom = -v;
  dirLight.shadow.camera.updateProjectionMatrix();
});

// Post Processing Controls
document.getElementById('tone-mapping-type').addEventListener('change', (e) => {
  renderer.toneMapping = parseInt(e.target.value);
});

setupSlider('exposure', (v) => renderer.toneMappingExposure = v);

document.getElementById('color-correction-enabled').addEventListener('change', (e) => {
  colorPass.enabled = e.target.checked;
});

setupSlider('saturation', (v) => colorPass.uniforms.saturation.value = v);
setupSlider('contrast', (v) => colorPass.uniforms.contrast.value = v);
setupSlider('brightness', (v) => colorPass.uniforms.brightness.value = v);

// Bloom Controls
document.getElementById('bloom-enabled').addEventListener('change', (e) => {
  bloomPass.enabled = e.target.checked;
});

setupSlider('bloom-intensity', (v) => bloomPass.strength = v);
setupSlider('bloom-threshold', (v) => bloomPass.threshold = v);
setupSlider('bloom-radius', (v) => bloomPass.radius = v);

// Resize
window.addEventListener('resize', () => {
  camera.aspect = canvas.clientWidth / canvas.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(canvas.clientWidth, canvas.clientHeight);
  composer.setSize(canvas.clientWidth, canvas.clientHeight);
  bloomPass.setSize(canvas.clientWidth, canvas.clientHeight);
});

// WASD Controls
const moveState = {
  forward: false,
  backward: false,
  left: false,
  right: false,
  up: false,
  down: false,
  shift: false
};

const moveSpeed = 0.003;
const moveSpeedFast = 0.01;

document.addEventListener('keydown', (e) => {
  // Ignore if typing in an input field
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  
  switch (e.code) {
    case 'KeyW': moveState.forward = true; break;
    case 'KeyS': moveState.backward = true; break;
    case 'KeyA': moveState.left = true; break;
    case 'KeyD': moveState.right = true; break;
    case 'KeyQ': moveState.down = true; break;
    case 'KeyE': moveState.up = true; break;
    case 'ShiftLeft':
    case 'ShiftRight': moveState.shift = true; break;
  }
});

document.addEventListener('keyup', (e) => {
  switch (e.code) {
    case 'KeyW': moveState.forward = false; break;
    case 'KeyS': moveState.backward = false; break;
    case 'KeyA': moveState.left = false; break;
    case 'KeyD': moveState.right = false; break;
    case 'KeyQ': moveState.down = false; break;
    case 'KeyE': moveState.up = false; break;
    case 'ShiftLeft':
    case 'ShiftRight': moveState.shift = false; break;
  }
});

function updateMovement() {
  const direction = new THREE.Vector3();
  camera.getWorldDirection(direction);
  
  const right = new THREE.Vector3();
  right.crossVectors(direction, camera.up).normalize();
  
  const speed = moveState.shift ? moveSpeedFast : moveSpeed;
  
  if (moveState.forward) {
    camera.position.addScaledVector(direction, speed);
    controls.target.addScaledVector(direction, speed);
  }
  if (moveState.backward) {
    camera.position.addScaledVector(direction, -speed);
    controls.target.addScaledVector(direction, -speed);
  }
  if (moveState.left) {
    camera.position.addScaledVector(right, -speed);
    controls.target.addScaledVector(right, -speed);
  }
  if (moveState.right) {
    camera.position.addScaledVector(right, speed);
    controls.target.addScaledVector(right, speed);
  }
  if (moveState.up) {
    camera.position.y += speed;
    controls.target.y += speed;
  }
  if (moveState.down) {
    camera.position.y -= speed;
    controls.target.y -= speed;
  }
}
// Animate
function animate() {
  requestAnimationFrame(animate);
  updateMovement();
  controls.update();
  composer.render();
  updateStats();
}

// ============================================
// SETTINGS SAVE/LOAD SYSTEM
// ============================================

function getCurrentSettings() {
  return {
    // Camera
    cameraFov: parseFloat(document.getElementById('camera-fov').value),
    
    // Environment
    hdrIntensity: parseFloat(document.getElementById('hdr-intensity').value),
    hdrRotation: parseFloat(document.getElementById('hdr-rotation').value),
    hdrBackground: document.getElementById('hdr-background').checked,
    
    // Ambient Light
    ambientColor: document.getElementById('ambient-color').value,
    ambientIntensity: parseFloat(document.getElementById('ambient-intensity').value),
    
    // Directional Light
    dirColor: document.getElementById('dir-color').value,
    dirIntensity: parseFloat(document.getElementById('dir-intensity').value),
    dirDirection: parseFloat(document.getElementById('dir-direction').value),
    dirElevation: parseFloat(document.getElementById('dir-elevation').value),
    
    // Shadows
    shadowType: parseInt(document.getElementById('shadow-type').value),
    shadowsEnabled: document.getElementById('shadows-enabled').checked,
    shadowBias: parseFloat(document.getElementById('shadow-bias').value),
    shadowNormalBias: parseFloat(document.getElementById('shadow-normal-bias').value),
    shadowMapSize: parseInt(document.getElementById('shadow-map-size').value),
    shadowRadius: parseFloat(document.getElementById('shadow-radius').value),
    shadowCameraSize: parseFloat(document.getElementById('shadow-camera-size').value),
    
    // Tone Mapping
    toneMappingType: parseInt(document.getElementById('tone-mapping-type').value),
    exposure: parseFloat(document.getElementById('exposure').value),
    
    // Color Correction
    colorCorrectionEnabled: document.getElementById('color-correction-enabled').checked,
    saturation: parseFloat(document.getElementById('saturation').value),
    contrast: parseFloat(document.getElementById('contrast').value),
    brightness: parseFloat(document.getElementById('brightness').value),
    
    // Bloom
    bloomEnabled: document.getElementById('bloom-enabled').checked,
    bloomIntensity: parseFloat(document.getElementById('bloom-intensity').value),
    bloomThreshold: parseFloat(document.getElementById('bloom-threshold').value),
    bloomRadius: parseFloat(document.getElementById('bloom-radius').value)
  };
}

function applySettings(settings) {
  // Camera
  if (settings.cameraFov !== undefined) {
    document.getElementById('camera-fov').value = settings.cameraFov;
    document.getElementById('camera-fov').dispatchEvent(new Event('input'));
  }
  
  // Environment
  document.getElementById('hdr-intensity').value = settings.hdrIntensity;
  document.getElementById('hdr-intensity').dispatchEvent(new Event('input'));
  document.getElementById('hdr-rotation').value = settings.hdrRotation;
  document.getElementById('hdr-rotation').dispatchEvent(new Event('input'));
  if (settings.hdrBackground !== undefined) {
    document.getElementById('hdr-background').checked = settings.hdrBackground;
    document.getElementById('hdr-background').dispatchEvent(new Event('change'));
  }
  
  // Ambient Light
  if (settings.ambientColor) {
    document.getElementById('ambient-color').value = settings.ambientColor;
    document.getElementById('ambient-color').dispatchEvent(new Event('input'));
  }
  document.getElementById('ambient-intensity').value = settings.ambientIntensity;
  document.getElementById('ambient-intensity').dispatchEvent(new Event('input'));
  
  // Directional Light
  if (settings.dirColor) {
    document.getElementById('dir-color').value = settings.dirColor;
    document.getElementById('dir-color').dispatchEvent(new Event('input'));
  }
  document.getElementById('dir-intensity').value = settings.dirIntensity;
  document.getElementById('dir-intensity').dispatchEvent(new Event('input'));
  document.getElementById('dir-direction').value = settings.dirDirection;
  document.getElementById('dir-direction').dispatchEvent(new Event('input'));
  document.getElementById('dir-elevation').value = settings.dirElevation;
  document.getElementById('dir-elevation').dispatchEvent(new Event('input'));
  
  // Shadows
  document.getElementById('shadow-type').value = settings.shadowType;
  document.getElementById('shadow-type').dispatchEvent(new Event('change'));
  document.getElementById('shadows-enabled').checked = settings.shadowsEnabled;
  document.getElementById('shadows-enabled').dispatchEvent(new Event('change'));
  document.getElementById('shadow-bias').value = settings.shadowBias;
  document.getElementById('shadow-bias').dispatchEvent(new Event('input'));
  document.getElementById('shadow-normal-bias').value = settings.shadowNormalBias;
  document.getElementById('shadow-normal-bias').dispatchEvent(new Event('input'));
  document.getElementById('shadow-map-size').value = settings.shadowMapSize;
  document.getElementById('shadow-map-size').dispatchEvent(new Event('change'));
  document.getElementById('shadow-radius').value = settings.shadowRadius;
  document.getElementById('shadow-radius').dispatchEvent(new Event('input'));
  document.getElementById('shadow-camera-size').value = settings.shadowCameraSize;
  document.getElementById('shadow-camera-size').dispatchEvent(new Event('input'));
  
  // Tone Mapping
  document.getElementById('tone-mapping-type').value = settings.toneMappingType;
  document.getElementById('tone-mapping-type').dispatchEvent(new Event('change'));
  document.getElementById('exposure').value = settings.exposure;
  document.getElementById('exposure').dispatchEvent(new Event('input'));
  
  // Color Correction
  document.getElementById('color-correction-enabled').checked = settings.colorCorrectionEnabled;
  document.getElementById('color-correction-enabled').dispatchEvent(new Event('change'));
  document.getElementById('saturation').value = settings.saturation;
  document.getElementById('saturation').dispatchEvent(new Event('input'));
  document.getElementById('contrast').value = settings.contrast;
  document.getElementById('contrast').dispatchEvent(new Event('input'));
  document.getElementById('brightness').value = settings.brightness;
  document.getElementById('brightness').dispatchEvent(new Event('input'));
  
  // Bloom
  document.getElementById('bloom-enabled').checked = settings.bloomEnabled;
  document.getElementById('bloom-enabled').dispatchEvent(new Event('change'));
  document.getElementById('bloom-intensity').value = settings.bloomIntensity;
  document.getElementById('bloom-intensity').dispatchEvent(new Event('input'));
  document.getElementById('bloom-threshold').value = settings.bloomThreshold;
  document.getElementById('bloom-threshold').dispatchEvent(new Event('input'));
  document.getElementById('bloom-radius').value = settings.bloomRadius;
  document.getElementById('bloom-radius').dispatchEvent(new Event('input'));
}

function generateJSCode(settings) {
  return `// ===== SAVED SETTINGS =====
// Camera
camera.fov = ${settings.cameraFov};
camera.updateProjectionMatrix();

// Environment
scene.environmentIntensity = ${settings.hdrIntensity};
scene.environmentRotation.y = ${settings.hdrRotation} * Math.PI / 180;
scene.background = ${settings.hdrBackground} ? envMap : new THREE.Color(0x33334e);

// Ambient Light
ambientLight.color.set('${settings.ambientColor}');
ambientLight.intensity = ${settings.ambientIntensity};

// Directional Light
dirLight.color.set('${settings.dirColor}');
dirLight.intensity = ${settings.dirIntensity};
// Direction: ${settings.dirDirection}°, Elevation: ${settings.dirElevation}°
const direction = ${settings.dirDirection} * Math.PI / 180;
const elevation = ${settings.dirElevation} * Math.PI / 180;
const distance = 10;
dirLight.position.x = Math.sin(direction) * Math.cos(elevation) * distance;
dirLight.position.y = Math.sin(elevation) * distance;
dirLight.position.z = Math.cos(direction) * Math.cos(elevation) * distance;

// Shadows
renderer.shadowMap.type = THREE.${['BasicShadowMap', 'PCFShadowMap', 'PCFSoftShadowMap', 'VSMShadowMap'][settings.shadowType]};
renderer.shadowMap.enabled = ${settings.shadowsEnabled};
dirLight.castShadow = ${settings.shadowsEnabled};
dirLight.shadow.bias = ${settings.shadowBias};
dirLight.shadow.normalBias = ${settings.shadowNormalBias};
dirLight.shadow.mapSize.width = ${settings.shadowMapSize};
dirLight.shadow.mapSize.height = ${settings.shadowMapSize};
dirLight.shadow.radius = ${settings.shadowRadius};
dirLight.shadow.camera.left = -${settings.shadowCameraSize};
dirLight.shadow.camera.right = ${settings.shadowCameraSize};
dirLight.shadow.camera.top = ${settings.shadowCameraSize};
dirLight.shadow.camera.bottom = -${settings.shadowCameraSize};

// Tone Mapping
renderer.toneMapping = THREE.${['NoToneMapping', 'LinearToneMapping', 'ReinhardToneMapping', 'CineonToneMapping', 'ACESFilmicToneMapping'][settings.toneMappingType]};
renderer.toneMappingExposure = ${settings.exposure};

// Color Correction
colorPass.enabled = ${settings.colorCorrectionEnabled};
colorPass.uniforms.saturation.value = ${settings.saturation};
colorPass.uniforms.contrast.value = ${settings.contrast};
colorPass.uniforms.brightness.value = ${settings.brightness};

// Bloom
bloomPass.enabled = ${settings.bloomEnabled};
bloomPass.strength = ${settings.bloomIntensity};
bloomPass.threshold = ${settings.bloomThreshold};
bloomPass.radius = ${settings.bloomRadius};
// ===== END SAVED SETTINGS =====`;
}

// Save to LocalStorage
document.getElementById('btn-save').addEventListener('click', () => {
  const settings = getCurrentSettings();
  localStorage.setItem('diriyah-settings', JSON.stringify(settings));
  alert('Settings saved to browser!');
});

// Load from LocalStorage
document.getElementById('btn-load').addEventListener('click', () => {
  const savedSettings = localStorage.getItem('diriyah-settings');
  if (savedSettings) {
    try {
      applySettings(JSON.parse(savedSettings));
      alert('Settings loaded!');
    } catch (err) {
      alert('Error loading settings');
    }
  } else {
    alert('No saved settings found');
  }
});

// Export JSON
document.getElementById('btn-export').addEventListener('click', () => {
  const settings = getCurrentSettings();
  const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'diriyah-settings.json';
  a.click();
  URL.revokeObjectURL(url);
});

// Import JSON
document.getElementById('btn-import').addEventListener('click', () => {
  document.getElementById('import-file').click();
});

document.getElementById('import-file').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = (event) => {
    try {
      const settings = JSON.parse(event.target.result);
      applySettings(settings);
      alert('Settings imported!');
    } catch (err) {
      alert('Error loading settings file');
    }
  };
  reader.readAsText(file);
  e.target.value = '';
});

// Copy Code
document.getElementById('btn-copy-code').addEventListener('click', () => {
  const settings = getCurrentSettings();
  const code = generateJSCode(settings);
  navigator.clipboard.writeText(code).then(() => {
    alert('JS code copied to clipboard!');
  });
});

// Load saved settings on startup
const savedSettings = localStorage.getItem('diriyah-settings');
if (savedSettings) {
  try {
    applySettings(JSON.parse(savedSettings));
  } catch (err) {
    console.warn('Could not load saved settings');
  }
}
animate();