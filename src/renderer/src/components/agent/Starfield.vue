<template>
  <canvas ref="canvasRef" class="starfield" aria-hidden="true" />
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";

const canvasRef = ref<HTMLCanvasElement | null>(null);

interface Star {
  angle: number;
  radius: number;
  speed: number;
  size: number;
  opacity: number;
  phase: number;
  temperature: number;
  flash: number;
  flashTimer: number;
  flashFactor: number;
}

interface Meteor {
  x: number;
  y: number;
  vx: number;
  vy: number;
  speed: number;
  length: number;
  opacity: number;
  life: number;
  maxLife: number;
  isBig: boolean;
}

interface Planet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  exploded: boolean;
  explodeLife: number;
}

const isDark = () =>
  document.documentElement.getAttribute("data-theme") === "dark";

const CONFIG = {
  starCount: 420,
  starMinSpeed: 0.000008,
  starMaxSpeed: 0.00003,
  starMinSize: 0.35,
  starMaxSize: 1.25,
  starMinOpacity: 0.18,
  starMaxOpacity: 0.72,
  flickerStrength: 0.22,
  flashChance: 0.08,
  flashMinInterval: 15000,
  flashMaxInterval: 45000,
  flashStrength: 0.8,
  minStarGap: 0,
  meteorMinInterval: 1800,
  meteorMaxInterval: 6500,
  maxSimultaneousMeteors: 2,
  bigMeteorChance: 0.09,
  meteorMinSpeed: 4,
  meteorMaxSpeed: 7,
  meteorMinLength: 130,
  meteorMaxLength: 260,
  bigMeteorSpeed: 2,
  bigMeteorLength: 420,
  meteorLife: 1100,
  meteorOpacity: 1,
  parallaxStrength: 0.015,
  planetMinInterval: 28000,
  planetMaxInterval: 56000,
  planetSpeed: 3.5,
};

let ctx: CanvasRenderingContext2D | null = null;
let width = 0;
let height = 0;
let centerX = 0;
let centerY = 0;
let dpr = 1;
const stars: Star[] = [];
const meteors: Meteor[] = [];
const planets: Planet[] = [];
let mouseX = 0;
let mouseY = 0;
let targetMouseX = 0;
let targetMouseY = 0;
let nextMeteorTime = 0;
let nextPlanetTime = 0;
let animationId: number | null = null;
let lastTime = performance.now();
let reduceMotion = false;
let themeObserver: MutationObserver | null = null;

function random(min: number, max: number) {
  return Math.random() * (max - min) + min;
}

function randomInt(min: number, max: number) {
  return Math.floor(random(min, max + 1));
}

function createStars() {
  stars.length = 0;
  const maxRadius = Math.sqrt(width * width + height * height);
  CONFIG.minStarGap = Math.max(18, Math.min(width, height) / 42);
  const gapSq = CONFIG.minStarGap * CONFIG.minStarGap;
  for (let i = 0; i < CONFIG.starCount; i++) {
    let angle = Math.random() * Math.PI * 2;
    let radius = Math.pow(Math.random(), 1.8) * maxRadius;
    let x = centerX + radius * Math.cos(angle);
    let y = centerY + radius * Math.sin(angle);
    let attempts = 0;
    while (attempts < 40) {
      let tooClose = false;
      for (let j = 0; j < stars.length; j++) {
        const s = stars[j];
        const sx = centerX + s.radius * Math.cos(s.angle);
        const sy = centerY + s.radius * Math.sin(s.angle);
        const dx = x - sx;
        const dy = y - sy;
        if (dx * dx + dy * dy < gapSq) {
          tooClose = true;
          break;
        }
      }
      if (!tooClose) break;
      angle = Math.random() * Math.PI * 2;
      radius = Math.pow(Math.random(), 1.8) * maxRadius;
      x = centerX + radius * Math.cos(angle);
      y = centerY + radius * Math.sin(angle);
      attempts++;
    }
    stars.push({
      angle,
      radius,
      speed: random(CONFIG.starMinSpeed, CONFIG.starMaxSpeed),
      size: random(CONFIG.starMinSize, CONFIG.starMaxSize),
      opacity: random(CONFIG.starMinOpacity, CONFIG.starMaxOpacity),
      phase: Math.random() * Math.PI * 2,
      temperature: Math.random(),
      flash: 0,
      flashTimer: random(
        CONFIG.flashMinInterval,
        CONFIG.flashMaxInterval
      ),
      flashFactor: random(0.6, 1.4),
    });
  }
}

function getStarColor(star: Star, opacity: number) {
  if (isDark()) {
    if (star.temperature < 0.08) return `rgba(180,210,255,${opacity})`;
    if (star.temperature > 0.92) return `rgba(255,225,190,${opacity})`;
    return `rgba(235,240,255,${opacity})`;
  }
  if (star.temperature < 0.08) return `rgba(70,100,170,${opacity})`;
  if (star.temperature > 0.92) return `rgba(110,95,80,${opacity})`;
  return `rgba(85,100,125,${opacity})`;
}

function drawStar(star: Star, time: number) {
  if (!ctx) return;
  star.angle += star.speed * (time - lastTime);
  let x = centerX + star.radius * Math.cos(star.angle);
  let y = centerY + star.radius * Math.sin(star.angle);
  x +=
    mouseX * CONFIG.parallaxStrength * (star.radius / Math.max(width, height));
  y +=
    mouseY * CONFIG.parallaxStrength * (star.radius / Math.max(width, height));

  const flicker = Math.sin(time * 0.0015 + star.phase);
  const flashBoost = star.flash * CONFIG.flashStrength * star.flashFactor;
  const flickerOpacity = star.opacity + flicker * CONFIG.flickerStrength * 0.25 + flashBoost;
  if (flickerOpacity <= 0) return;
  if (x < -10 || x > width + 10 || y < -10 || y > height + 10) return;

  ctx.beginPath();
  ctx.arc(x, y, star.size * (1 + flashBoost * 0.5), 0, Math.PI * 2);
  ctx.fillStyle = getStarColor(star, Math.min(flickerOpacity, 1));
  ctx.fill();

  if (star.size > 1 && (flickerOpacity > 0.45 || flashBoost > 0.1)) {
    const glowRadius = star.size * (3 + flashBoost * 4);
    ctx.beginPath();
    ctx.arc(x, y, glowRadius, 0, Math.PI * 2);
    const glow = ctx.createRadialGradient(x, y, 0, x, y, glowRadius);
    glow.addColorStop(0, getStarColor(star, Math.min(flickerOpacity * 0.22, 1)));
    glow.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = glow;
    ctx.fill();
  }
}

function updateStars(delta: number) {
  for (let i = 0; i < stars.length; i++) {
    const star = stars[i];
    if (star.flash > 0) {
      star.flash = Math.max(0, star.flash - delta * 0.002);
    } else {
      star.flashTimer -= delta;
      if (
        star.flashTimer <= 0 &&
        Math.random() < CONFIG.flashChance
      ) {
        star.flash = 1;
      }
      if (star.flashTimer <= -CONFIG.flashMaxInterval) {
        star.flashTimer = random(
          CONFIG.flashMinInterval,
          CONFIG.flashMaxInterval
        );
      }
    }
  }
}

function createMeteor() {
  const isBig = Math.random() < CONFIG.bigMeteorChance;
  const startSide = randomInt(0, 2);
  let x: number;
  let y: number;
  if (startSide === 0) {
    x = random(-250, width * 0.5);
    y = random(-180, height * 0.25);
  } else if (startSide === 1) {
    x = random(-180, width * 0.2);
    y = random(0, height * 0.45);
  } else {
    x = random(width * 0.15, width * 0.85);
    y = -250;
  }
  const angle = random(Math.PI * 0.16, Math.PI * 0.36);
  const speed = isBig
    ? random(CONFIG.bigMeteorSpeed * 0.85, CONFIG.bigMeteorSpeed * 1.15)
    : random(CONFIG.meteorMinSpeed, CONFIG.meteorMaxSpeed);
  meteors.push({
    x,
    y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    speed,
    length: isBig
      ? random(CONFIG.bigMeteorLength * 0.8, CONFIG.bigMeteorLength * 1.2)
      : random(CONFIG.meteorMinLength, CONFIG.meteorMaxLength),
    opacity: CONFIG.meteorOpacity,
    life: 0,
    maxLife: random(CONFIG.meteorLife * 0.7, CONFIG.meteorLife * 1.25),
    isBig,
  });
}

function drawMeteor(meteor: Meteor, delta: number) {
  if (!ctx) return;
  meteor.x += meteor.vx * delta * 0.06;
  meteor.y += meteor.vy * delta * 0.06;
  meteor.life += delta;
  const progress = meteor.life / meteor.maxLife;
  let opacity = meteor.opacity;
  if (progress < 0.15) {
    opacity *= progress / 0.15;
  } else if (progress > 0.7) {
    opacity *= 1 - (progress - 0.7) / 0.3;
  }
  if (opacity <= 0) return;

  const tailX = meteor.x - (meteor.vx * meteor.length) / meteor.speed;
  const tailY = meteor.y - (meteor.vy * meteor.length) / meteor.speed;

  if (meteor.isBig) {
    const headColor = isDark() ? "255,250,235" : "120,130,220";
    const coreColor = isDark() ? "255,244,215" : "150,160,235";
    const midColor = isDark() ? "220,225,255" : "130,140,225";
    const tailColor = isDark() ? "170,190,255" : "150,160,220";

    ctx.save();
    ctx.lineCap = "round";
    ctx.globalCompositeOperation = "lighter";

    const outerGrad = ctx.createLinearGradient(meteor.x, meteor.y, tailX, tailY);
    outerGrad.addColorStop(0, `rgba(${midColor},${opacity * 0.5})`);
    outerGrad.addColorStop(0.5, `rgba(${tailColor},${opacity * 0.22})`);
    outerGrad.addColorStop(1, `rgba(${tailColor},0)`);
    ctx.strokeStyle = outerGrad;
    ctx.lineWidth = 12;
    ctx.shadowBlur = 22;
    ctx.shadowColor = isDark()
      ? `rgba(200,220,255,${opacity * 0.8})`
      : `rgba(130,140,225,${opacity * 0.5})`;
    ctx.beginPath();
    ctx.moveTo(meteor.x, meteor.y);
    ctx.lineTo(tailX, tailY);
    ctx.stroke();

    const innerGrad = ctx.createLinearGradient(meteor.x, meteor.y, tailX, tailY);
    innerGrad.addColorStop(0, `rgba(${coreColor},${opacity})`);
    innerGrad.addColorStop(0.18, `rgba(${midColor},${opacity * 0.85})`);
    innerGrad.addColorStop(0.6, `rgba(${tailColor},${opacity * 0.3})`);
    innerGrad.addColorStop(1, `rgba(${tailColor},0)`);
    ctx.strokeStyle = innerGrad;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(meteor.x, meteor.y);
    ctx.lineTo(tailX, tailY);
    ctx.stroke();

    const headHalo = ctx.createRadialGradient(meteor.x, meteor.y, 0, meteor.x, meteor.y, 16);
    headHalo.addColorStop(0, `rgba(${headColor},${opacity})`);
    headHalo.addColorStop(0.4, `rgba(${coreColor},${opacity * 0.5})`);
    headHalo.addColorStop(1, `rgba(${midColor},0)`);
    ctx.fillStyle = headHalo;
    ctx.beginPath();
    ctx.arc(meteor.x, meteor.y, 16, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = isDark()
      ? `rgba(255,250,240,${opacity})`
      : `rgba(160,170,240,${opacity})`;
    ctx.beginPath();
    ctx.arc(meteor.x, meteor.y, 3.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
    return;
  }

  const headColor = isDark() ? "255,255,255" : "80,105,200";
  const midColor = isDark() ? "200,225,255" : "110,130,210";
  const tailColor = isDark() ? "160,195,255" : "150,160,220";
  const gradient = ctx.createLinearGradient(meteor.x, meteor.y, tailX, tailY);
  gradient.addColorStop(0, `rgba(${headColor},${opacity})`);
  gradient.addColorStop(0.08, `rgba(${midColor},${opacity * 0.85})`);
  gradient.addColorStop(0.35, `rgba(${tailColor},${opacity * 0.4})`);
  gradient.addColorStop(1, `rgba(${tailColor},0)`);

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = gradient;
  ctx.shadowBlur = 14;
  ctx.shadowColor = isDark()
    ? `rgba(200,225,255,${opacity * 0.75})`
    : `rgba(90,115,210,${opacity * 0.6})`;
  ctx.beginPath();
  ctx.moveTo(meteor.x, meteor.y);
  ctx.lineTo(tailX, tailY);
  ctx.stroke();

  ctx.shadowBlur = 18;
  ctx.beginPath();
  ctx.arc(meteor.x, meteor.y, 1.8, 0, Math.PI * 2);
  ctx.fillStyle = isDark()
    ? `rgba(255,255,255,${opacity})`
    : `rgba(90,115,210,${opacity})`;
  ctx.fill();
  ctx.restore();
}

function scheduleNextMeteor() {
  nextMeteorTime = performance.now() + random(CONFIG.meteorMinInterval, CONFIG.meteorMaxInterval);
}

function createPlanet() {
  const fromLeft = Math.random() > 0.5;
  const y = random(height * 0.15, height * 0.7);
  const x = fromLeft ? -120 : width + 120;
  const speed = random(CONFIG.planetSpeed * 0.7, CONFIG.planetSpeed * 1.3);
  const angle = fromLeft ? random(0.08, 0.2) : Math.PI - random(0.08, 0.2);
  planets.push({
    x,
    y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    life: 0,
    maxLife: 2600,
    exploded: false,
    explodeLife: 0,
  });
}

function drawPlanet(planet: Planet, delta: number) {
  if (!ctx) return;
  planet.life += delta;
  if (!planet.exploded) {
    planet.x += planet.vx * delta * 0.06;
    planet.y += planet.vy * delta * 0.06;
    const outOfView =
      planet.x < -200 ||
      planet.x > width + 200 ||
      planet.y < -200 ||
      planet.y > height + 200;
    if (outOfView || planet.life > planet.maxLife) {
      planet.exploded = true;
      planet.explodeLife = 0;
    } else {
      const tailX = planet.x - planet.vx * 60;
      const tailY = planet.y - planet.vy * 60;
      const headColor = isDark() ? "255,240,220" : "180,120,70";
      const tailColor = isDark() ? "255,190,140" : "200,140,90";
      const gradient = ctx.createLinearGradient(planet.x, planet.y, tailX, tailY);
      gradient.addColorStop(0, `rgba(${headColor},0.9)`);
      gradient.addColorStop(1, `rgba(${tailColor},0)`);
      ctx.save();
      ctx.lineCap = "round";
      ctx.lineWidth = 6;
      ctx.strokeStyle = gradient;
      ctx.shadowBlur = 20;
      ctx.shadowColor = isDark() ? "rgba(255,200,150,0.8)" : "rgba(200,140,90,0.6)";
      ctx.beginPath();
      ctx.moveTo(planet.x, planet.y);
      ctx.lineTo(tailX, tailY);
      ctx.stroke();
      const halo = ctx.createRadialGradient(planet.x, planet.y, 0, planet.x, planet.y, 22);
      halo.addColorStop(0, isDark() ? "rgba(255,220,180,0.9)" : "rgba(200,140,90,0.8)");
      halo.addColorStop(1, "rgba(255,255,255,0)");
      ctx.beginPath();
      ctx.arc(planet.x, planet.y, 22, 0, Math.PI * 2);
      ctx.fillStyle = halo;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(planet.x, planet.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = isDark() ? "rgba(255,245,230,1)" : "rgba(210,150,90,1)";
      ctx.fill();
      ctx.restore();
    }
  }
  if (planet.exploded) {
    planet.explodeLife += delta;
    const p = planet.explodeLife / 1000;
    if (p >= 1) return;
    const fade = 1 - p;
    const radius = 6 + p * 140;
    const ring = isDark()
      ? `rgba(255,200,150,${0.7 * fade})`
      : `rgba(200,140,90,${0.6 * fade})`;
    const ring2 = isDark()
      ? `rgba(255,230,200,${0.45 * fade})`
      : `rgba(220,170,120,${0.4 * fade})`;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineWidth = 2;
    ctx.shadowBlur = 30;
    ctx.shadowColor = isDark() ? "rgba(255,190,140,0.8)" : "rgba(200,140,90,0.6)";
    ctx.strokeStyle = ring;
    ctx.beginPath();
    ctx.arc(planet.x, planet.y, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = ring2;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(planet.x, planet.y, radius * 0.65, 0, Math.PI * 2);
    ctx.stroke();
    const burst = ctx.createRadialGradient(planet.x, planet.y, 0, planet.x, planet.y, 90);
    burst.addColorStop(0, isDark() ? `rgba(255,230,190,${0.6 * fade})` : `rgba(220,170,120,${0.5 * fade})`);
    burst.addColorStop(1, "rgba(255,255,255,0)");
    ctx.beginPath();
    ctx.arc(planet.x, planet.y, 90, 0, Math.PI * 2);
    ctx.fillStyle = burst;
    ctx.fill();
    ctx.restore();
  }
}

function updatePlanets(delta: number) {
  if (
    !reduceMotion &&
    planets.length === 0 &&
    performance.now() >= nextPlanetTime
  ) {
    createPlanet();
    nextPlanetTime =
      performance.now() + random(CONFIG.planetMinInterval, CONFIG.planetMaxInterval);
  }
  for (let i = planets.length - 1; i >= 0; i--) {
    const planet = planets[i];
    drawPlanet(planet, delta);
    if (planet.exploded && planet.explodeLife >= 1000) {
      planets.splice(i, 1);
    }
  }
}

function updateMeteors(delta: number) {
  if (
    !reduceMotion &&
    meteors.length < CONFIG.maxSimultaneousMeteors &&
    performance.now() >= nextMeteorTime
  ) {
    createMeteor();
    scheduleNextMeteor();
  }
  for (let i = meteors.length - 1; i >= 0; i--) {
    const meteor = meteors[i];
    drawMeteor(meteor, delta);
    if (
      meteor.life > meteor.maxLife ||
      meteor.x > width + 300 ||
      meteor.y > height + 300
    ) {
      meteors.splice(i, 1);
    }
  }
}

function animate(time: number) {
  if (!ctx) return;
  // 限制delta最大值，避免后台切换后的大跳跃
  const delta = Math.min(time - lastTime, 50);
  lastTime = time;
  ctx.clearRect(0, 0, width, height);
  // 使用缓动跟随鼠标
  mouseX += (targetMouseX - mouseX) * 0.04;
  mouseY += (targetMouseY - mouseY) * 0.04;
  // 批量绘制星星
  for (let i = 0; i < stars.length; i++) drawStar(stars[i], time);
  updateStars(delta);
  updateMeteors(delta);
  updatePlanets(delta);
  animationId = requestAnimationFrame(animate);
}

// 防抖计时器
let resizeTimer: ReturnType<typeof setTimeout> | null = null;

function resizeCanvas() {
  // 防抖：避免频繁重绘
  if (resizeTimer) clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    performResize();
  }, 100);
}

function performResize() {
  const canvas = canvasRef.value;
  if (!canvas) return;
  width = window.innerWidth;
  height = window.innerHeight;
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx = canvas.getContext("2d");
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  centerX = width / 2;
  centerY = height / 2;
  // 只在星星数量不匹配时才重建（避免每次resize都重建）
  if (stars.length !== CONFIG.starCount) {
    createStars();
  }
  scheduleNextMeteor();
  nextPlanetTime =
    performance.now() + random(CONFIG.planetMinInterval, CONFIG.planetMaxInterval);
}

function handleReducedMotion() {
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  reduceMotion = media.matches;
  meteors.length = 0;
  if (reduceMotion) {
    CONFIG.starCount = 180;
    CONFIG.starMinSpeed = 0;
    CONFIG.starMaxSpeed = 0;
  } else {
    CONFIG.starCount = 420;
    CONFIG.starMinSpeed = 0.000008;
    CONFIG.starMaxSpeed = 0.00003;
  }
  createStars();
}

function handleMouseMove(event: MouseEvent) {
  targetMouseX = event.clientX - width / 2;
  targetMouseY = event.clientY - height / 2;
}

function handleVisibility() {
  if (document.hidden) {
    if (animationId !== null) cancelAnimationFrame(animationId);
    animationId = null;
  } else {
    lastTime = performance.now();
    if (animationId === null) animationId = requestAnimationFrame(animate);
  }
}

onMounted(() => {
  resizeCanvas();
  handleReducedMotion();
  animationId = requestAnimationFrame(animate);
  window.addEventListener("resize", resizeCanvas);
  window.addEventListener("mousemove", handleMouseMove, { passive: true });
  document.addEventListener("visibilitychange", handleVisibility);
  const reduceMotionMedia = window.matchMedia("(prefers-reduced-motion: reduce)");
  reduceMotionMedia.addEventListener("change", handleReducedMotion);
  themeObserver = new MutationObserver(() => createStars());
  themeObserver.observe(document.documentElement, { attributes: true });
});

onBeforeUnmount(() => {
  if (animationId !== null) cancelAnimationFrame(animationId);
  animationId = null;
  window.removeEventListener("resize", resizeCanvas);
  window.removeEventListener("mousemove", handleMouseMove);
  document.removeEventListener("visibilitychange", handleVisibility);
  window.matchMedia("(prefers-reduced-motion: reduce)").removeEventListener("change", handleReducedMotion);
  themeObserver?.disconnect();
  meteors.length = 0;
  planets.length = 0;
  stars.length = 0;
});
</script>

<style scoped>
.starfield {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 0;
  pointer-events: none;
}
</style>
