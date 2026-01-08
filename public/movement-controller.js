export default class MovementController {
  defaultSpeed = 0.1;
  speed = this.defaultSpeed;
  moving = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    up: false,
    down: false,
  };

  constructor(canvas, camera) {
    this.camera = camera;
    document.addEventListener("keydown", this.onKeyDown.bind(this));
    document.addEventListener("keyup", this.onKeyUp.bind(this));

    canvas.addEventListener("mousemove", (event) => {
      this.camera.transform.rotation[1] -= event.movementX * 0.002;
      this.camera.transform.rotation[0] -= event.movementY * 0.002;
    });
  }

  onKeyDown(event) {
    const eventKey = event.key.toLowerCase();
    console.log("Key down:", eventKey);
    if (eventKey === "w") {
      this.moving.forward = true;
    }
    if (eventKey === "s") {
      this.moving.backward = true;
    }
    if (eventKey === "a") {
      this.moving.left = true;
    }
    if (eventKey === "d") {
      this.moving.right = true;
    }
    if (eventKey === " ") {
      this.moving.up = true;
    }
    if (eventKey === "shift") {
      this.moving.down = true;
    }
    if (eventKey === "q") {
      this.speed = 5.0;
    }
  }

  onKeyUp(event) {
    const eventKey = event.key.toLowerCase();
    if (eventKey === "w") {
      this.moving.forward = false;
    }
    if (eventKey === "s") {
      this.moving.backward = false;
    }
    if (eventKey === "a") {
      this.moving.left = false;
    }
    if (eventKey === "d") {
      this.moving.right = false;
    }
    if (eventKey === " ") {
      this.moving.up = false;
    }
    if (eventKey === "shift") {
      this.moving.down = false;
    }
    if (eventKey === "q") {
      this.speed = this.defaultSpeed;
    }
  }

  updateMovement() {
    const forward = [
      Math.sin(this.camera.transform.rotation[1]),
      0,
      Math.cos(this.camera.transform.rotation[1]),
    ];
    const right = [
      Math.cos(this.camera.transform.rotation[1]),
      0,
      -Math.sin(this.camera.transform.rotation[1]),
    ];

    if (this.moving.forward) {
      this.camera.transform.translation[0] -= forward[0] * this.speed;
      this.camera.transform.translation[2] -= forward[2] * this.speed;
    }
    if (this.moving.backward) {
      this.camera.transform.translation[0] += forward[0] * this.speed;
      this.camera.transform.translation[2] += forward[2] * this.speed;
    }
    if (this.moving.left) {
      this.camera.transform.translation[0] -= right[0] * this.speed;
      this.camera.transform.translation[2] -= right[2] * this.speed;
    }
    if (this.moving.right) {
      this.camera.transform.translation[0] += right[0] * this.speed;
      this.camera.transform.translation[2] += right[2] * this.speed;
    }
    if (this.moving.up) {
      this.camera.transform.translation[1] += this.speed;
    }
    if (this.moving.down) {
      this.camera.transform.translation[1] -= this.speed;
    }
  }
}
