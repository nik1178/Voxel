import * as Transform from "./transform.js";

export function multiply(a, b) {
    // IMPLEMENT

    var result = identity();

    for (let i = 0; i < a.length; i++) {
        for (let j = 0; j < b[0].length; j++) {
            let sum = 0;
            for (let k = 0; k < a[0].length; k++) {
                sum += a[i][k] * b[k][j];
            }
            result[i][j] = sum;
        }
    }

    return result;
}

export function multiplyMatrixVector4(m, v) {
    var result = [];
    for (let i = 0; i < m.length; i++) {
        let sum = 0;
        for (let j = 0; j < v.length; j++) {
            sum += m[i][j] * v[j];
        }
        result.push(sum);
    }
    return result;
}

export function subtractVectors(v1, v2) {
    var result = [];

    for (let i = 0; i < v1.length; i++) {
        result.push(v1[i] - v2[i]);
    }

    return result;
}

export function multiplyVectors(v1, v2) {
    var result = 0;

    for (let i = 0; i < v1.length; i++) {
        result += v1[i] * v2[i];
    }

    return result;
}

export function multiplyVectorScalar(v, s) {
    var result = [];

    for (let i = 0; i < v.length; i++) {
        result.push(v[i] * s);
    }

    return result;
}

export function transform(a, v) {
    // IMPLEMENT - Multiply the matrix `a` by the vector `v`

    var result = [];
    for (let i = 0; i < a.length; i++) {
        let sum = 0;
        for (let j = 0; j < v.length; j++) {
            sum += a[i][j] * v[j];
        }
        result.push(sum);
    }

    return result;
}

export function identity() {
    // This is here to demonstrate the matrix format:
    // array of 4 arrays of 4 numbers
    return [
        [1, 0, 0, 0],
        [0, 1, 0, 0],
        [0, 0, 1, 0],
        [0, 0, 0, 1],
    ];
}

export function translation(dx, dy, dz) {
    // IMPLEMENT

    var result = identity();
    result[0][3] = dx;
    result[1][3] = dy;
    result[2][3] = dz;

    return result;
}

export function scale(sx, sy, sz) {
    // IMPLEMENT

    var result = identity();
    result[0][0] = sx;
    result[1][1] = sy;
    result[2][2] = sz;

    return result;
}

export function rotationX(angle) {
    // IMPLEMENT

    var result = identity();

    var cos = Math.cos(angle);
    var sin = Math.sin(angle);

    result[1][1] = cos;
    result[1][2] = -sin;
    result[2][1] = sin;
    result[2][2] = cos;

    return result;
}

export function rotationY(angle) {
    // IMPLEMENT

    var result = identity();

    var cos = Math.cos(angle);
    var sin = Math.sin(angle);
    
    result[0][0] = cos;
    result[0][2] = sin;
    result[2][0] = -sin;
    result[2][2] = cos;

    return result;
}

export function rotationZ(angle) {
    // IMPLEMENT

    var result = identity();

    var cos = Math.cos(angle);
    var sin = Math.sin(angle);

    result[0][0] = cos;
    result[0][1] = -sin;
    result[1][0] = sin;
    result[1][1] = cos;

    return result;
}

export function perspective(fov, aspect, near, far) {
    // IMPLEMENT
    // HINT: as in lecture slides, assume d = 1

    // h/2d = tan (fov/2)
    // d = 1
    // h/2 = tan (fov/2)
    // h = 2 * tan (fov/2)

    var h = 2 * Math.tan(fov / 2);
    var w = h * aspect;

    var result = identity();
    result[0][0] = 2 / w;
    result[1][1] = 2 / h;
    result[2][2] = far / (near - far);
    result[2][3] = (far * near) / (near - far);
    result[3][2] = -1; // 1/d
    result[3][3] = 0;

    return result;
}

export function viewport(x, y, w, h) {
    // IMPLEMENT
    // HINT: you may have to flip the image upside down,
    // because the Y axis points down on the canvas

    var result = identity();

    // Scale x and y to fit within [-1, 1]
    result[0][0] = w / 2;
    result[1][1] = -h / 2;  // Flip Y-axis for left-handed system
    result[2][2] = 1;       // Keep z scale

    // Translation to apply global offset and centering
    result[0][3] = x + w / 2;
    result[1][3] = y + h / 2;
    result[2][3] = 0;       // No translation for z

    return result;
}

export function getViewProjectionMatrix(camera, canvas) {
  let viewMatrix = Transform.inverseTransform(camera.transform);
  let perspectiveMatrix = perspective(
    camera.fov,
    canvas.width / canvas.height,
    camera.near,
    camera.far
  );
  return multiply(perspectiveMatrix, viewMatrix);
}

export function inverse(m) {
  let out = [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0]
  ];

  let a00 = m[0][0], a01 = m[0][1], a02 = m[0][2], a03 = m[0][3];
  let a10 = m[1][0], a11 = m[1][1], a12 = m[1][2], a13 = m[1][3];
  let a20 = m[2][0], a21 = m[2][1], a22 = m[2][2], a23 = m[2][3];
  let a30 = m[3][0], a31 = m[3][1], a32 = m[3][2], a33 = m[3][3];

  let b00 = a00 * a11 - a01 * a10;
  let b01 = a00 * a12 - a02 * a10;
  let b02 = a00 * a13 - a03 * a10;
  let b03 = a01 * a12 - a02 * a11;
  let b04 = a01 * a13 - a03 * a11;
  let b05 = a02 * a13 - a03 * a12;
  let b06 = a20 * a31 - a21 * a30;
  let b07 = a20 * a32 - a22 * a30;
  let b08 = a20 * a33 - a23 * a30;
  let b09 = a21 * a32 - a22 * a31;
  let b10 = a21 * a33 - a23 * a31;
  let b11 = a22 * a33 - a23 * a32;

  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;

  if (!det) { 
    return null; 
  }

  let detInv = 1.0 / det;

  out[0][0] = (a11 * b11 - a12 * b10 + a13 * b09) * detInv;
  out[0][1] = (a02 * b10 - a01 * b11 - a03 * b09) * detInv;
  out[0][2] = (a31 * b05 - a32 * b04 + a33 * b03) * detInv;
  out[0][3] = (a22 * b04 - a21 * b05 - a23 * b03) * detInv;
  
  out[1][0] = (a12 * b08 - a10 * b11 - a13 * b07) * detInv;
  out[1][1] = (a00 * b11 - a02 * b08 + a03 * b07) * detInv;
  out[1][2] = (a32 * b02 - a30 * b05 - a33 * b01) * detInv;
  out[1][3] = (a20 * b05 - a22 * b02 + a23 * b01) * detInv;
  
  out[2][0] = (a10 * b10 - a11 * b08 + a13 * b06) * detInv;
  out[2][1] = (a01 * b08 - a00 * b10 - a03 * b06) * detInv;
  out[2][2] = (a30 * b04 - a31 * b02 + a33 * b00) * detInv;
  out[2][3] = (a21 * b02 - a20 * b04 - a23 * b00) * detInv;
  
  out[3][0] = (a11 * b07 - a10 * b09 - a12 * b06) * detInv;
  out[3][1] = (a00 * b09 - a01 * b07 + a02 * b06) * detInv;
  out[3][2] = (a31 * b01 - a30 * b03 - a32 * b00) * detInv;
  out[3][3] = (a20 * b03 - a21 * b01 + a22 * b00) * detInv;

  return out;
}