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
}

const isDark = () =>
  document.documentElement.getAttribute("data-theme") === "dark";

const CONFIG = {
  starCount: 420,
  starMinSpeed: 0.00008,
  starMaxSpeed: 0.00028,
  starMinSize: 0.35,
  starMaxSize: 1.25,
  starMinOpacity: 0.12,
  starMaxOpacity: 0.65,
  flickerStrength: 0.18,
  meteorMinInterval: 3500,
  meteorMaxInterval: 11000,
  meteorMinSpeed: 7,
  meteorMaxSpeed: 12,
  meteorMinLength: 80,
  meteorMaxLength: 180,
  meteorLife: 1000,
  meteorOpacity: 0.85,
  parallaxStrength: 0.015,
};

let ctx: CanvasRenderingContext2D | null = null;
let width = 0;
let height = 0;
let centerX = 0;
let centerY = 0;
let dpr = 1;
const stars: Star[] = [];
const meteors: Meteor[] = [];
let mouseX = 0;
let mouseY = 0;
let targetMouseX = 0;
let targetMouseY = 0;
let nextMeteorTime = 0;
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
  for (let i = 0; i < CONFIG.starCount; i++) {
    stars.push({
      angle: Math.random() * Math.PI * 2,
      radius: Math.random() * maxRadius,
      speed: random(CONFIG.starMinSpeed, CONFIG.starMaxSpeed),
      size: random(CONFIG.starMinSize, CONFIG.starMaxSize),
      opacity: random(CONFIG.starMinOpacity, CONFIG.starMaxOpacity),
      phase: Math.random() * Math.PI * 2,
      temperature: Math.random(),
    });
  }
}

function getStarColor(star: Star, opacity: number) {
  if (isDark()) {
    if (star.temperature < 0.08) return `rgba(180,210,255,${opacity})`;
    if (star.temperature > 0.92) return `rgba(255,225,190,${opacity})`;
    return `rgba(235,240,255,${opacity})`;
  }
  if (star.temperature < 0.08) return `rgba(90,120,180,${opacity})`;
  if (star.temperature > 0.92) return `rgba(120,110,100,${opacity})`;
  return `rgba(100,110,130,${opacity})`;
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
  const flickerOpacity = star.opacity + flicker * CONFIG.flickerStrength * 0.25;
  if (flickerOpacity <= 0) return;
  if (x < -10 || x > width + 10 || y < -10 || y > height + 10) return;

  ctx.beginPath();
  ctx.arc(x, y, star.size, 0, Math.PI * 2);
  ctx.fillStyle = getStarColor(star, flickerOpacity);
  ctx.fill();

  if (star.size > 1 && flickerOpacity > 0.45) {
    ctx.beginPath();
    ctx.arc(x, y, star.size * 3, 0, Math.PI * 2);
    const glow = ctx.createRadialGradient(x, y, 0, x, y, star.size * 3);
    glow.addColorStop(0, getStarColor(star, flickerOpacity * 0.18));
    glow.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = glow;
    ctx.fill();
  }
}

function createMeteor() {
  const startSide = randomInt(0, 2);
  let x: number;
  let y: number;
  if (startSide === 0) {
    x = random(-200, width * 0.5);
    y = random(-150, height * 0.2);
  } else if (startSide === 1) {
    x = random(-150, width * 0.2);
    y = random(0, height * 0.4);
  } else {
    x = random(width * 0.2, width * 0.8);
    y = -200;
  }
  const angle = random(Math.PI * 0.18, Math.PI * 0.32);
  const speed = random(CONFIG.meteorMinSpeed, CONFIG.meteorMaxSpeed);
  meteors.push({
    x,
    y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    speed,
    length: random(CONFIG.meteorMinLength, CONFIG.meteorMaxLength),
    opacity: CONFIG.meteorOpacity,
    life: 0,
    maxLife: random(CONFIG.meteorLife * 0.7, CONFIG.meteorLife * 1.25),
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
  const gradient = ctx.createLinearGradient(meteor.x, meteor.y, tailX, tailY);
  gradient.addColorStop(0, `rgba(255,255,255,${opacity})`);
  gradient.addColorStop(0.08, `rgba(225,240,255,${opacity * 0.8})`);
  gradient.addColorStop(0.35, `rgba(180,210,255,${opacity * 0.35})`);
  gradient.addColorStop(1, "rgba(150,190,255,0)");

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineWidth = 2;
  ctx.strokeStyle = gradient;
  ctx.shadowBlur = 12;
  ctx.shadowColor = `rgba(190,220,255,${opacity * 0.7})`;
  ctx.beginPath();
  ctx.moveTo(meteor.x, meteor.y);
  ctx.lineTo(tailX, tailY);
  ctx.stroke();

  ctx.shadowBlur = 16;
  ctx.beginPath();
  ctx.arc(meteor.x, meteor.y, 1.5, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(255,255,255,${opacity})`;
  ctx.fill();
  ctx.restore();
}

function scheduleNextMeteor() {
  nextMeteorTime = performance.now() + random(CONFIG.meteorMinInterval, CONFIG.meteorMaxInterval);
}

function updateMeteors(delta: number) {
  if (isDark() && !reduceMotion && meteors.length === 0 && performance.now() >= nextMeteorTime) {
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
  const delta = Math.min(time - lastTime, 50);
  ctx.clearRect(0, 0, width, height);
  mouseX += (targetMouseX - mouseX) * 0.04;
  mouseY += (targetMouseY - mouseY) * 0.04;
  for (let i = 0; i < stars.length; i++) drawStar(stars[i], time);
  updateMeteors(delta);
  lastTime = time;
  animationId = requestAnimationFrame(animate);
}

function resizeCanvas() {
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
  createStars();
  scheduleNextMeteor();
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
    CONFIG.starMinSpeed = 0.00008;
    CONFIG.starMaxSpeed = 0.00028;
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
