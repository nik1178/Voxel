import MovementController from "./movement-controller.js";

export default class Player {
    camera = {
        transform: {
            translation: [0, 1, 3],
            rotation: [0, 0, 0],
        },
        fov: 1,
        near: 0.01,
        far: 10000,
    };
    constructor(canvas) {
        this.position = { x: 0, y: 0, z: 0 };
        this.rotation = { x: 0, y: 0, z: 0 };
        this.movementController = new MovementController(canvas, this.camera);
    }

    update() {
        this.movementController.updateMovement();
    }
}