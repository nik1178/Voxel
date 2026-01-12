import * as Matrix from "./matrix.js"; 

export function inverseTransform({
    translation = [0, 0, 0],
    rotation = [0, 0, 0],
    scale = [1, 1, 1],
} = {}) {
  var scaleMatrix = Matrix.scale(1 / scale[0], 1 / scale[1], 1 / scale[2]);
  var rotationMatrixX = Matrix.rotationX(-rotation[0]);
  var rotationMatrixY = Matrix.rotationY(-rotation[1]);
  var rotationMatrixZ = Matrix.rotationZ(-rotation[2]);
  var translationMatrix = Matrix.translation(-translation[0], -translation[1], -translation[2]);
  var result = Matrix.identity();
  result = Matrix.multiply(result, scaleMatrix);
  result = Matrix.multiply(result, rotationMatrixX);
  result = Matrix.multiply(result, rotationMatrixY);
  result = Matrix.multiply(result, rotationMatrixZ);
  result = Matrix.multiply(result, translationMatrix);

  return result;
}