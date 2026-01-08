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