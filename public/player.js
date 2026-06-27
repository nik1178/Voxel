import MovementController from "./movement-controller.js";

export default class Player {
    camera = {
        transform: {
            // translation: [-40000, 300, 75000], // Gameljne
            // translation: [-90000, 500, 50000], // Novo mesto
            // translation: [-430000, 500, 120000],
            translation: [-40782.7, 10000, 70405.3],
            rotation: [-Math.PI/4, Math.PI, 0],
        },
        fov: 1,
        near: 1,
        far: 10000000,
    };
    constructor(canvas) {
        this.position = { x: 0, y: 0, z: 0 };
        this.rotation = { x: 0, y: 0, z: 0 };
        this.movementController = new MovementController(canvas, this.camera);

        this.displayPosition();
    }

    displayPosition() {
        const fields = document.querySelectorAll(".position-field");
        
        fields.forEach(field => {
            const positionType = field.getAttribute("data-position-type");
            const position = this.camera.transform.translation;
            field.textContent = position[0].toFixed(1) + ", " + position[1].toFixed(1) + ", " + position[2].toFixed(1);
        });
    }

    update(dt) {
        this.movementController.updateMovement(dt);

        this.displayPosition();
    }

    getTranslation() {
        return this.camera.transform.translation;
    }

    getPositionVector() {
        return {x: this.camera.transform.translation[0], y: this.camera.transform.translation[1], z: this.camera.transform.translation[2]};
    }
}