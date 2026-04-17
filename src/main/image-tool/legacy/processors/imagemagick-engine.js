import imageMagickProcessor from '../imagemagick.js';

export const imageMagickEngine = {
  id: 'imagemagick',
  label: 'ImageMagick',
  kind: 'local-cli',
  processor: imageMagickProcessor,
  capabilities: [
    'single-operation',
    'chain-operation',
    'metadata-identify',
    'installation-check',
  ],
};

export default imageMagickEngine;
