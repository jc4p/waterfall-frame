import * as THREE from 'three';

// Create scene, camera, and renderer
const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// Track burst state for current drop
let currentDropBurst = false;
let burstPosition = new THREE.Vector2(-1, -1);
let burstTime = -1;
let score = 0;
let gameOver = false;
const scoreElement = document.getElementById('score');
const gameOverModal = document.getElementById('gameOverModal');
const finalScoreElement = document.getElementById('finalScore');

// Function to end the game
function endGame() {
  if (!gameOver) {
    gameOver = true;
    finalScoreElement.textContent = score;
    gameOverModal.style.display = 'block';
    // Add entrance animation
    gameOverModal.style.opacity = '0';
    gameOverModal.style.transform = 'translate(-50%, -60%)';
    setTimeout(() => {
      gameOverModal.style.opacity = '1';
      gameOverModal.style.transform = 'translate(-50%, -50%)';
    }, 0);
  }
}

// Custom shader material for water-like gradient
const gradientMaterial = new THREE.ShaderMaterial({
  uniforms: {
    uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
    uColorA: { value: new THREE.Color('#4a90e2') },  // Lighter blue
    uColorB: { value: new THREE.Color('#87ceeb') },  // Sky blue
    uWaterLevel: { value: 0.0 },  // Current water level
    uTargetWaterLevel: { value: 0.0 },  // Target water level for animation
    uLastImpactTime: { value: -1.0 },  // Time of last impact for particle effects
    uJustHitWater: { value: 0.0 },  // Flag for immediate impact
    uMouseClick: { value: new THREE.Vector2(-1, -1) },  // Mouse click position
    uClickTime: { value: -1.0 },  // Time of last click
    uDropBurst: { value: 0.0 },  // Flag for mid-air burst
    uBurstY: { value: -1.0 }  // Y position where burst occurred
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform float uTime;
    uniform vec2 uResolution;
    uniform vec3 uColorA;
    uniform vec3 uColorB;
    uniform float uWaterLevel;
    uniform float uTargetWaterLevel;
    uniform float uLastImpactTime;
    uniform float uJustHitWater;
    uniform vec2 uMouseClick;
    uniform float uClickTime;
    uniform float uDropBurst;
    uniform float uBurstY;
    varying vec2 vUv;

    // Function to create a smooth curve
    float curve(float x, float frequency, float amplitude) {
      return sin(x * frequency + uTime) * amplitude;
    }

    // Function to create particles
    float particle(vec2 uv, vec2 center, float size, float fade) {
      float dist = length(uv - center);
      return smoothstep(size, size * 0.8, dist) * fade;
    }

    // Function to create burst effect
    float createBurst(vec2 uv, vec2 center, float size, float timeSinceImpact) {
      float burst = 0.0;
      if (timeSinceImpact < 0.5) {
        float burstPhase = timeSinceImpact * 2.0;
        float numParticles = 12.0;
        
        for (float i = 0.0; i < numParticles; i++) {
          float angle = (i / numParticles) * 6.28 + burstPhase * 2.0;
          float radius = burstPhase * 0.2; // Increased spread
          vec2 offset = vec2(cos(angle), abs(sin(angle)) * 0.5) * radius;
          vec2 particleCenter = center + offset;
          float fade = 1.0 - smoothstep(0.0, 1.0, burstPhase);
          burst += particle(uv, particleCenter, size * 0.3, fade); // Larger particles
        }
      }
      return burst;
    }

    // Function to draw the falling elongated teardrop with squash and stretch
    float raindrop(vec2 uv, float size) {
      float animatedWaterLevel = mix(uWaterLevel, uTargetWaterLevel, 
        smoothstep(0.0, 1.0, (uTime - uLastImpactTime) * 2.0));
      float waterLineY = (50.0 / uResolution.y) + animatedWaterLevel;
      
      float cycleTime = mod(uTime * 0.5, 1.4);
      float dropY = 1.2 - cycleTime;
      
      bool hasHitWater = dropY < waterLineY;
      vec2 dropCenter = vec2(0.5, dropY);
      
      // If drop has hit water or was clicked
      if (hasHitWater) {
        dropY = waterLineY;
      } else if (uDropBurst > 0.5) {
        // Immediately burst with larger size
        return createBurst(uv, dropCenter, size * 1.5, uTime - uClickTime);
      }
      
      vec2 pos = (uv - dropCenter) / size;
      float stretch = 1.0;
      float squash = 1.0;
      
      float distToWater = dropY - waterLineY;
      if (distToWater > 0.0 && distToWater < 0.1) {
        stretch *= (1.0 - (1.0 - distToWater * 10.0) * 0.3);
        squash *= (1.0 + (1.0 - distToWater * 10.0) * 0.4);
      }
      
      pos.y *= stretch;
      pos.x *= squash;
      
      float dropShape;
      if (pos.y < 0.0) {
        dropShape = length(pos);
      } else {
        float width = 1.0 - pos.y * 0.8;
        width = max(width, 0.1);
        dropShape = abs(pos.x) / width + pos.y;
      }
      
      float burst = 0.0;
      if (uJustHitWater > 0.5 || (hasHitWater && distToWater > -0.001)) {
        burst = createBurst(uv, vec2(0.5, waterLineY), size, uTime - uLastImpactTime);
      }
      
      return smoothstep(1.0, 0.8, dropShape) + burst;
    }

    // Function to create waterline with accumulated water
    float waterline(vec2 uv) {
      float baseY = 50.0 / uResolution.y;
      float animatedWaterLevel = mix(uWaterLevel, uTargetWaterLevel, 
        smoothstep(0.0, 1.0, (uTime - uLastImpactTime) * 2.0));
      float y = baseY + animatedWaterLevel;
      float wave = 0.0;
      
      wave += curve(uv.x, 6.0, 0.005);
      wave += curve(uv.x, 12.0, 0.003);
      wave += curve(uv.x, 18.0, 0.002);
      
      return smoothstep(0.0, 0.002, uv.y - y - wave);
    }

    void main() {
      float noise = sin(vUv.y * 10.0 + uTime) * 0.1;
      float mixValue = vUv.y + noise;
      vec3 gradientColor = mix(uColorA, uColorB, mixValue);

      float water = waterline(vUv);
      vec3 waterColor = mix(vec3(0.2, 0.4, 0.8), gradientColor, water);

      float drop = raindrop(vUv, 0.03);
      vec3 dropColor = mix(waterColor, vec3(0.7, 0.8, 0.9), drop);

      gl_FragColor = vec4(dropColor, 1.0);
    }
  `
});

// Create a plane that fills the viewport
const geometry = new THREE.PlaneGeometry(2, 2);
const plane = new THREE.Mesh(geometry, gradientMaterial);
scene.add(plane);

// Track last impact time for water level increase
let lastImpactTime = 0;
let lastDropY = 1.2;
const WATER_INCREASE_PER_DROP = 0.05; // 5% increase per drop

// Function to update score with animation
function updateScore() {
  if (!gameOver) {
    score++;
    // Animate score element
    scoreElement.style.transform = 'scale(1.2)';
    scoreElement.textContent = score;
    setTimeout(() => {
      scoreElement.style.transform = 'scale(1)';
    }, 100);
  }
}

// Handle mouse/touch interaction
function handleClick(event) {
  if (gameOver) return; // Ignore clicks if game is over
  
  event.preventDefault(); // Prevent any default behavior
  
  const rect = renderer.domElement.getBoundingClientRect();
  const x = (event.clientX - rect.left) / rect.width;
  const y = 1 - (event.clientY - rect.top) / rect.height;
  
  const timeSeconds = performance.now() * 0.001;
  const cycleTime = (timeSeconds * 0.5) % 1.4;
  const dropY = 1.2 - cycleTime;
  const waterLineY = (50.0 / window.innerHeight) + gradientMaterial.uniforms.uWaterLevel.value;
  
  // Super forgiving click detection
  const horizontalThreshold = 0.4;  // Almost half the screen width
  const verticalThreshold = 0.3;    // Very forgiving vertical detection
  const dx = Math.abs(x - 0.5);
  const dy = Math.abs(y - dropY);
  
  if (dx < horizontalThreshold && dy < verticalThreshold && dropY > waterLineY && !currentDropBurst) {
    currentDropBurst = true;
    updateScore();
    
    // Set all burst-related uniforms immediately
    gradientMaterial.uniforms.uMouseClick.value.set(0.5, dropY);
    gradientMaterial.uniforms.uClickTime.value = timeSeconds;
    gradientMaterial.uniforms.uDropBurst.value = 1.0;
    gradientMaterial.uniforms.uBurstY.value = dropY;
  }
}

// Add both mousedown and click handlers for better reliability
renderer.domElement.addEventListener('mousedown', handleClick);
renderer.domElement.addEventListener('click', handleClick);
renderer.domElement.addEventListener('touchstart', (e) => {
  e.preventDefault();
  handleClick(e.touches[0]);
}, { passive: false });

// Animation loop
function animate(time) {
  const timeSeconds = time * 0.001;
  requestAnimationFrame(animate);
  
  if (!gameOver) {
    gradientMaterial.uniforms.uTime.value = timeSeconds;
    
    const cycleTime = (timeSeconds * 0.5) % 1.4;
    const currentDropY = 1.2 - cycleTime;
    const waterLineY = (50.0 / window.innerHeight) + gradientMaterial.uniforms.uWaterLevel.value;
    
    // Check for game over condition
    if (waterLineY > 0.9) { // 90% of screen height
      endGame();
      return;
    }
    
    // Only reset burst state at the start of a new cycle
    if (cycleTime < 0.1 && lastImpactTime > 0.1) {
      currentDropBurst = false;
      gradientMaterial.uniforms.uDropBurst.value = 0.0;
      gradientMaterial.uniforms.uBurstY.value = -1.0;
      gradientMaterial.uniforms.uJustHitWater.value = 0.0;
    }
    
    if (currentDropY < waterLineY && lastDropY >= waterLineY && !currentDropBurst) {
      gradientMaterial.uniforms.uLastImpactTime.value = timeSeconds;
      gradientMaterial.uniforms.uJustHitWater.value = 1.0;
      gradientMaterial.uniforms.uWaterLevel.value = gradientMaterial.uniforms.uTargetWaterLevel.value;
      gradientMaterial.uniforms.uTargetWaterLevel.value += WATER_INCREASE_PER_DROP;
    }
    
    lastDropY = currentDropY;
    lastImpactTime = cycleTime;
  }
  
  renderer.render(scene, camera);
}

// Handle window resize
window.addEventListener('resize', () => {
  const width = window.innerWidth;
  const height = window.innerHeight;
  renderer.setSize(width, height);
  gradientMaterial.uniforms.uResolution.value.set(width, height);
});

// Add transition to score element for smooth animations
scoreElement.style.transition = 'transform 0.1s ease-out';
gameOverModal.style.transition = 'all 0.3s ease-out';

// Start animation
animate(0);
