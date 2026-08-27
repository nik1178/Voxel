export default class MovementController {
  defaultSpeed = 1000;
  speed = this.defaultSpeed;
  speedRamp = 0;
  lookPointerId = null;
  lastLook = [0, 0];
  pause = false;
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

    // Add mouse wheel event listener for zooming
    canvas.addEventListener("wheel", (event) => {
      if (event.deltaY < 0) {
        this.defaultSpeed *= 1.1;
      } else {
        this.defaultSpeed /= 1.1;
      }
      this.speed = this.defaultSpeed;
    });

    canvas.addEventListener("pointerdown", (event) => {
      if (event.pointerType !== "touch" || this.lookPointerId !== null) return;
      this.lookPointerId = event.pointerId;
      this.lastLook = [event.clientX, event.clientY];
    });
    canvas.addEventListener("pointermove", (event) => {
      if (event.pointerId !== this.lookPointerId) return;
      this.camera.transform.rotation[1] -= (event.clientX - this.lastLook[0]) * 0.005;
      this.camera.transform.rotation[0] -= (event.clientY - this.lastLook[1]) * 0.005;
      this.lastLook = [event.clientX, event.clientY];
    });
    const endLook = (event) => {
      if (event.pointerId === this.lookPointerId) this.lookPointerId = null;
    };
    canvas.addEventListener("pointerup", endLook);
    canvas.addEventListener("pointercancel", endLook);

    this.setupDpads();

    document.addEventListener("ui-toggled", (event) => {
      this.paused = event.detail;
      // Hidden dpad buttons never fire pointerup, so drop any held state.
      for (const key of Object.keys(this.moving)) this.moving[key] = false;
      this.speedRamp = 0;
    });
  }

  setupDpads() {
    document.querySelectorAll("#mobile-controls .dpad-btn").forEach((button) => {
      const action = button.dataset.action;
      const press = (event) => {
        event.preventDefault();
        this.setAction(action, true);
      };
      const release = () => this.setAction(action, false);
      button.addEventListener("pointerdown", press);
      button.addEventListener("pointerup", release);
      button.addEventListener("pointercancel", release);
      button.addEventListener("pointerleave", release);
    });
  }

  setAction(action, active) {
    if (action === "faster") {
      this.speedRamp = active ? 1 : 0;
    } else if (action === "slower") {
      this.speedRamp = active ? -1 : 0;
    } else {
      this.moving[action] = active;
    }
  }

  onKeyDown(event) {
    if (this.paused) {
      return;
    }
    
    const eventKey = event.key.toLowerCase();
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
      event.preventDefault();
    }
    if (eventKey === "shift") {
      this.moving.down = true;
    }
    if (eventKey === "q") {
      this.speed *= 1.1;
    }
  }

  onKeyUp(event) {
    if (this.paused) {
      return;
    }

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

  updateMovement(dt) {
    if (this.paused) {
      return;
    }

    if (this.speedRamp) {
      // x4 per second held, in the spirit of the wheel's 1.1 per notch.
      this.defaultSpeed *= Math.pow(4, this.speedRamp * dt);
      this.speed = this.defaultSpeed;
    }

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
      this.camera.transform.translation[0] -= forward[0] * this.speed * dt;
      this.camera.transform.translation[2] -= forward[2] * this.speed * dt;
    }
    if (this.moving.backward) {
      this.camera.transform.translation[0] += forward[0] * this.speed * dt;
      this.camera.transform.translation[2] += forward[2] * this.speed * dt;
    }
    if (this.moving.left) {
      this.camera.transform.translation[0] -= right[0] * this.speed * dt;
      this.camera.transform.translation[2] -= right[2] * this.speed * dt;
    }
    if (this.moving.right) {
      this.camera.transform.translation[0] += right[0] * this.speed * dt;
      this.camera.transform.translation[2] += right[2] * this.speed * dt;
    }
    if (this.moving.up) {
      this.camera.transform.translation[1] += this.speed * dt;
    }
    if (this.moving.down) {
      this.camera.transform.translation[1] -= this.speed * dt;
    }
  }
}
