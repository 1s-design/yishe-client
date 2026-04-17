import imageMagickEngine from './imagemagick-engine.js';

const PROCESSOR_REGISTRATIONS = [
  imageMagickEngine,
];

const PROCESSOR_REGISTRATION_MAP = new Map(
  PROCESSOR_REGISTRATIONS.map((registration) => [registration.id, registration]),
);

export function listImageProcessorRegistrations() {
  return PROCESSOR_REGISTRATIONS.map((registration) => ({
    id: registration.id,
    label: registration.label,
    kind: registration.kind,
    capabilities: [...(registration.capabilities || [])],
  }));
}

export function getDefaultImageProcessorId() {
  const configuredId = String(process.env.IMAGE_PROCESSOR_ENGINE || 'imagemagick').trim();
  return PROCESSOR_REGISTRATION_MAP.has(configuredId) ? configuredId : 'imagemagick';
}

export function resolveImageProcessorRegistration(requestedId) {
  const normalizedId = String(requestedId || getDefaultImageProcessorId()).trim();
  const registration = PROCESSOR_REGISTRATION_MAP.get(normalizedId);

  if (!registration) {
    const available = Array.from(PROCESSOR_REGISTRATION_MAP.keys()).join(', ');
    throw new Error(`不支持的图像处理引擎: ${normalizedId}，可选值: ${available}`);
  }

  return registration;
}

export function resolveImageProcessor(requestedId) {
  return resolveImageProcessorRegistration(requestedId).processor;
}

export async function getImageProcessorStatus(requestedId) {
  const registration = resolveImageProcessorRegistration(requestedId);
  const installation = await registration.processor.checkInstallation();

  return {
    id: registration.id,
    label: registration.label,
    kind: registration.kind,
    isDefault: registration.id === getDefaultImageProcessorId(),
    capabilities: [...(registration.capabilities || [])],
    ...installation,
  };
}

export async function getAllImageProcessorStatuses() {
  const statuses = [];

  for (const registration of PROCESSOR_REGISTRATIONS) {
    statuses.push(await getImageProcessorStatus(registration.id));
  }

  return statuses;
}
