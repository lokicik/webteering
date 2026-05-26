import { Checkpoint, VoxelType } from '../sharedTypes';

interface ImportedMapData {
  elevation: number[];
  features: VoxelType[];
  course: Checkpoint[];
  size: number;
}

export class MapImporter {
  // Standard orienteering colors mapped to VoxelType
  private colorMapKeys: { r: number; g: number; b: number; type: VoxelType }[] = [
    { r: 255, g: 255, b: 255, type: 'forest' },  // White forest
    { r: 255, g: 248, b: 208, type: 'field' },   // Off-yellow open
    { r: 255, g: 240, b: 0,   type: 'field' },   // Bright yellow field
    { r: 208, g: 240, b: 208, type: 'walk' },    // Light green slow forest
    { r: 96,  g: 192, b: 96,  type: 'thicket' }, // Medium green difficult
    { r: 0,   g: 128, b: 0,   type: 'thicket' }, // Dark green thicket
    { r: 0,   g: 160, b: 240, type: 'water' },   // Blue water
    { r: 0,   g: 0,   b: 0,   type: 'cliff' },   // Black rocks/cliffs
    { r: 160, g: 96,  b: 32,  type: 'path' }     // Brown dirt track
  ];

  // Helper to load image securely
  private loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous'; // Avoid CORS tainted canvas problems
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
      img.src = url;
    });
  }

  // Calculate closest Euclidean RGB distance to standardize color maps
  private getClosestVoxelType(r: number, g: number, b: number): VoxelType {
    let closestType: VoxelType = 'forest';
    let minDistance = Infinity;

    for (const key of this.colorMapKeys) {
      const d = Math.sqrt(
        Math.pow(r - key.r, 2) +
        Math.pow(g - key.g, 2) +
        Math.pow(b - key.b, 2)
      );
      if (d < minDistance) {
        minDistance = d;
        closestType = key.type;
      }
    }

    return closestType;
  }

  // XML Parser for IOF course data
  public parseIOFCourseXML(xmlText: string, mapSize: number): Checkpoint[] {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
    const checkpoints: Checkpoint[] = [];
    
    // Scan standard IOF v3 or simplified custom elements
    const controls = xmlDoc.getElementsByTagName('Control');
    const half = mapSize / 2;

    for (let i = 0; i < controls.length; i++) {
      const node = controls[i];
      const idStr = node.getElementsByTagName('Id')[0]?.textContent || (i + 1).toString();
      const code = idStr;
      
      // Parse map canvas coordinates
      const mapPosNode = node.getElementsByTagName('MapPosition')[0];
      const mapX = parseFloat(mapPosNode?.getAttribute('x') || '0');
      const mapZ = parseFloat(mapPosNode?.getAttribute('y') || '0'); // y-attr maps to Z-axis in 3D
      
      const description = node.getElementsByTagName('Description')[0]?.textContent || 'Checkpoint';

      // Translate map-pixels relative to center
      const x = Math.round(mapX - half);
      const z = Math.round(mapZ - half);

      checkpoints.push({
        id: i + 1,
        code,
        x,
        z,
        description
      });
    }

    return checkpoints;
  }

  // Full import engine. Combines loaded files into compiled dataset
  public async importMapPackage(
    elevationImgUrl: string,
    featuresImgUrl: string,
    iofXmlUrl?: string
  ): Promise<ImportedMapData> {
    
    // 1. Load both images concurrently
    const [elevationImg, featuresImg] = await Promise.all([
      this.loadImage(elevationImgUrl),
      this.loadImage(featuresImgUrl)
    ]);

    const size = elevationImg.width; // Assume square maps (e.g. 256x256, 512x512)
    if (featuresImg.width !== size || featuresImg.height !== size || elevationImg.height !== size) {
      throw new Error('Elevation and feature map images must be of identical square dimensions.');
    }

    // 2. Parse elevation canvas pixels
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not create 2D canvas context.');

    // Scan elevation
    ctx.drawImage(elevationImg, 0, 0);
    const elevationPixels = ctx.getImageData(0, 0, size, size).data;
    
    // Scan features
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(featuresImg, 0, 0);
    const featurePixels = ctx.getImageData(0, 0, size, size).data;

    const elevation: number[] = new Array(size * size);
    const features: VoxelType[] = new Array(size * size);

    // Scaling bounds (brightness to height index: e.g. 1-24 voxels)
    const heightScale = 22.0 / 255.0;

    for (let i = 0; i < size * size; i++) {
      const idx = i * 4;
      
      // Gray level (red channel is sufficient for grayscale)
      const gray = elevationPixels[idx];
      elevation[i] = Math.max(1, Math.round(gray * heightScale));

      // RGB feature standardizer
      const r = featurePixels[idx];
      const g = featurePixels[idx + 1];
      const b = featurePixels[idx + 2];
      features[i] = this.getClosestVoxelType(r, g, b);
    }

    // 3. Load XML course data
    let course: Checkpoint[] = [];
    if (iofXmlUrl) {
      try {
        const response = await fetch(iofXmlUrl);
        const xmlText = await response.text();
        course = this.parseIOFCourseXML(xmlText, size);
      } catch {
        console.warn('Could not load course XML file, generating default course instead.');
      }
    }

    return {
      elevation,
      features,
      course,
      size
    };
  }
}
