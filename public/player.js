import MovementController from "./movement-controller.js";

export default class Player {
    camera = {
        transform: {
            // translation: [-40000, 300, 75000], // Gameljne
            translation: [-90000, 500, 50000], // Novo mesto
            rotation: [0, 0, 0],
        },
        fov: 1,
        near: 1,
        far: 10000000,
    };
    constructor(canvas) {
        this.position = { x: 0, y: 0, z: 0 };
        this.rotation = { x: 0, y: 0, z: 0 };
        this.movementController = new MovementController(canvas, this.camera);
    }

    update(dt) {
        this.movementController.updateMovement(dt);
    }
}