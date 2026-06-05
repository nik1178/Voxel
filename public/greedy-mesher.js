export class GreedyMesher {
    mesher = null;

    static getMesher() {
        if (this.mesher == null) {
            this.mesher = new GreedyMesher();
        }
        return this.mesher;
    }
    remesh(heightMapData) {
        const heightMap = heightMapData.heightData;
        const size = Math.floor(Math.sqrt(heightMap.length));
        let cleared = new Uint8Array(heightMap.length).fill(0);
        const planes = [];

        // Top face
        for (let z = 0; z < size; z++) {
            for (let x = 0; x < size; x++) {
                if (cleared[z*size + x]) continue;
                
                const height = heightMap[z*size + x];
                if (height === 0) continue; // Optional: don't mesh empty space

                // 1. Find length along X
                let lengthX = 1;
                while (x + lengthX < size) {
                    const nextIdx = z * size + (x + lengthX);
                    if (cleared[nextIdx] || heightMap[nextIdx] !== height) {
                        break;
                    }
                    lengthX++;
                }

                // 2. Find length along Z (can we expand this row downwards?)
                let lengthZ = 1;
                /* let canExpandZ = true;
                while (z + lengthZ < size && canExpandZ) {
                    // Check the entire row of lengthX at z + lengthZ
                    for (let i = 0; i < lengthX; i++) {
                        const nextIdx = (z + lengthZ) * size + (x + i);
                        if (cleared[nextIdx] || heightMap[nextIdx] !== height) {
                            canExpandZ = false;
                            break;
                        }
                    }
                    if (canExpandZ) {
                        lengthZ++;
                    }
                } */

                // Mark all covered voxels as cleared
                for (let dz = 0; dz < lengthZ; dz++) {
                    for (let dx = 0; dx < lengthX; dx++) {
                        cleared[(z + dz) * size + (x + dx)] = 1;
                    }
                }
                
                planes.push({x, z, lengthX, lengthZ, height, orientation: 0});
            }
        }

        let before = planes.length;
        // Side faces parallel to X axis (Front +Z / Back -Z)
        let clearedZ = new Uint8Array(heightMap.length).fill(0);
        for (let z = 0; z < size - 1; z++) {
            for (let x = 0; x < size; x++) {
                if (clearedZ[z * size + x]) continue;
                
                const height = heightMap[z * size + x];
                const neighbor_h = heightMap[(z + 1) * size + x];
                
                if (height === neighbor_h) continue; 
                
                let orientation = height > neighbor_h ? 1 : 3;
                
                let lengthX = 1;
                while (x + lengthX < size) {
                    const nextIdx = z * size + (x + lengthX);
                    const nextNeighborIdx = (z + 1) * size + (x + lengthX);
                    if (clearedZ[nextIdx]) break;
                    if (heightMap[nextIdx] !== height || heightMap[nextNeighborIdx] !== neighbor_h) break;
                    lengthX++;
                }
                
                for (let dx = 0; dx < lengthX; dx++) {
                    clearedZ[z * size + (x + dx)] = 1;
                }
                
                if (orientation === 1) { // Front face (+z) belongs to (x, z)
                    planes.push({x, z, lengthX, lengthZ: 1, height, orientation: 1});
                } else { // Back face (-z) belongs to (x, z+1)
                    planes.push({x, z: z + 1, lengthX, lengthZ: 1, height: neighbor_h, orientation: 3});
                }
            }
        }

        // Side faces parallel to Z axis (Right +X / Left -X)
        let clearedX = new Uint8Array(heightMap.length).fill(0);
        for (let x = 0; x < size - 1; x++) {
            for (let z = 0; z < size; z++) {
                if (clearedX[z * size + x]) continue;
                
                const height = heightMap[z * size + x];
                const neighbor_h = heightMap[z * size + (x + 1)];
                
                if (height === neighbor_h) continue;
                
                let orientation = height > neighbor_h ? 4 : 2;
                
                let lengthZ = 1;
                while (z + lengthZ < size) {
                    const nextIdx = (z + lengthZ) * size + x;
                    const nextNeighborIdx = (z + lengthZ) * size + (x + 1);
                    if (clearedX[nextIdx]) break;
                    if (heightMap[nextIdx] !== height || heightMap[nextNeighborIdx] !== neighbor_h) break;
                    lengthZ++;
                }
                
                for (let dz = 0; dz < lengthZ; dz++) {
                    clearedX[(z + dz) * size + x] = 1;
                }
                
                if (orientation === 2) { // Right face (+x) belongs to (x, z)
                    planes.push({x, z, lengthX: 1, lengthZ, height, orientation});
                } else { // Left face (-x) belongs to (x+1, z)
                    planes.push({x: x + 1, z, lengthX: 1, lengthZ, height: neighbor_h, orientation});
                }
            }
        }

        console.log("Side planes: ", planes.length - before);

        return planes;
    }

    toInstanceArray(planes) {
        // Max needed X and Z are 1000, so 10 bits per POS, Y max is 3000, so 12 bits, maximum X and Z size is 1000, so 10 bits * 2 for X and Z, orientation max is 4, so 3 bits, 
        // 10+10+12+20+3 = 55 bits, can fit in 64 bit uint
        // 4 16-bit integers = 64 bits, can fit in 64 bit uint = 8 bytes
        const instanceArray = new Uint32Array(planes.length * 2);
        let i = 0;
        for (const plane of planes) {
            let val = BigInt(plane.x);
            val |= BigInt(plane.z) << 10n;
            val |= BigInt(plane.lengthX) << 20n;
            val |= BigInt(plane.lengthZ) << 30n;
            val |= BigInt(plane.height) << 40n;
            val |= BigInt(plane.orientation) << 52n;
            instanceArray[i+1] = Number(val & 0xFFFFFFFFn);
            instanceArray[i] = Number(val >> 32n);
            i += 2;
        }
        return instanceArray;
    }
}