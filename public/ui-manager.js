export class UIManager {
    constructor() {
        this.setupListeners();
    }

    setupListeners() {
        const ui = document.getElementById("ui");
        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape") {
                e.preventDefault();
                ui.classList.toggle("invisible");
                document.body.focus();
            }
        });

        const positionFields = document.querySelectorAll(".position-field");
        positionFields.forEach((field) => {
            field.addEventListener("click", () => {
                // Copy position to clipboard
                navigator.clipboard.writeText(field.innerText);
            });
        });

        // Toggles
        const toggles = document.querySelectorAll(".toggle");
        toggles.forEach((toggle) => {
            toggle.addEventListener("click", () => {
                toggle.classList.toggle("active");
            });
        });

        const cullingToggle = document.getElementById("culling-toggle");
        if (cullingToggle) {
            cullingToggle.addEventListener("click", () => {
                let isActive = cullingToggle.classList.contains("active");
                document.dispatchEvent(new CustomEvent("culling-toggled", { detail: isActive }));
            });
        }

        const fxToggle = document.getElementById("fx-toggle");
        if (fxToggle) {
            fxToggle.addEventListener("click", () => {
                let isActive = fxToggle.classList.contains("active");
                document.dispatchEvent(new CustomEvent("fx-toggled", { detail: isActive }));
            });
        }

        const socketToggle = document.getElementById("socket-toggle");
        if (socketToggle) {
            socketToggle.addEventListener("click", () => {
                let isActive = socketToggle.classList.contains("active");
                document.dispatchEvent(new CustomEvent("socket-toggled", { detail: isActive }));
            });
        }

        // Sliders
        // const sliders = document.querySelectorAll(".slider");
        // sliders.forEach((slider) => {
        //     new Slider(slider, -1000, 1000, false);
        // });
        const chunkSizeSlider = document.querySelector("#chunk-size");
        new Slider(chunkSizeSlider, 2, 1000, false, 0, 2);
        const viewDistanceSlider = document.querySelector("#view-distance");
        new Slider(viewDistanceSlider, 0, 200000, false, 0, 5);
        const lodLimitsSlider = document.querySelector("#lod-limits");
        new Slider(lodLimitsSlider, 0, 9, true, 0);

        // Render type dropdown
        const renderTypeSelect = document.querySelector(".render-type-container select");
        if (renderTypeSelect) {
            renderTypeSelect.addEventListener("change", (e) => {
                console.log("Changed render type to: ", e.target.value);
                document.dispatchEvent(new CustomEvent("culling-toggled", { detail: false }));
                document.dispatchEvent(new CustomEvent("render-type-changed", { detail: e.target.value }));
                cullingToggle.classList.remove("active");

                if (e.target.value === "planes") {
                    cullingToggle.classList.remove("invisible");
                } else {
                    cullingToggle.classList.add("invisible");
                }
            });
        }

        const chunkStrategySelect = document.querySelector(".chunk-strategy-container select");
        if (chunkStrategySelect) {
            chunkStrategySelect.addEventListener("change", (e) => {
                console.log("Changed chunk strategy to: ", e.target.value);
                document.dispatchEvent(new CustomEvent("chunk-strategy-changed", { detail: e.target.value }));
            });
        }

        const inputField = document.querySelector("#command-input");
        new InputField(inputField);

    }
}

class Slider {
    constructor(containerDomElement, minVal, maxVal, double=false, decimalPlaces=2, exponent=1) {
        if (!containerDomElement.id) {
            throw new Error("Slider must have an ID");
        }
        if (minVal >= maxVal) {
            throw new Error("Min value must be less than max value");
        }

        this.domElement = containerDomElement;
        this.minVal = minVal;
        this.maxVal = maxVal;
        this.double = double;
        this.decimalPlaces = decimalPlaces;
        this.value = minVal;
        this.pressed = false;
        this.exponent = exponent;

        this.setupHTML();
        this.setupListeners();
    }

    setupListeners() {
        this.domElement.addEventListener("mousedown", (e) => {
            // if (e.target !== this.domElement && !this.domElement.contains(e.target)) {
            //     return;
            // }
            e.preventDefault();
            this.pressed = true;
            this.updateHandles(e);
        });
        window.addEventListener("mousemove", (e) => {
            if (this.pressed) {
                this.updateHandles(e);
            }
        });
        window.addEventListener("mouseup", (e) => {
            if (this.pressed) {
                this.dispatch();
            }
            this.pressed = false;
            
        });
    }

    setupHTML() {
        this.setupContainers();
        this.setupSliderLine();
        this.setupHandles();
    }

    setupContainers() {
        if (this.double) {
            this.minContainer = document.createElement("div");
            this.minContainer.classList.add("slider-container");
            this.domElement.appendChild(this.minContainer);
            this.minContainer.innerText = this.minVal.toFixed(this.decimalPlaces);
        }

        this.sliderLineContainer = document.createElement("div");
        this.sliderLineContainer.classList.add("slider-line-container");
        this.domElement.appendChild(this.sliderLineContainer);
        
        this.maxContainer = document.createElement("div");
        this.maxContainer.classList.add("slider-container");
        this.domElement.appendChild(this.maxContainer);
        this.maxContainer.innerText = this.maxVal.toFixed(this.decimalPlaces);
    }

    setupSliderLine() {
        this.sliderLine = document.createElement("div");
        this.sliderLine.classList.add("slider-line");
        this.sliderLineContainer.appendChild(this.sliderLine);
    }

    setupHandles() {
        this.handle1 = document.createElement("div");
        this.handle1.classList.add("handle");
        this.domElement.appendChild(this.handle1);
        this.positionHandle(this.handle1, this.minVal);

        if (this.double) {
            this.handle2 = document.createElement("div");
            this.handle2.classList.add("handle");
            this.domElement.appendChild(this.handle2);
            this.positionHandle(this.handle2, this.maxVal);
        }
    }

    updateHandles(e) {
        let xPos = e.clientX - this.sliderLineContainer.getBoundingClientRect().left;
        let rangeValue = (xPos / this.sliderLineContainer.clientWidth); // [0,1]
        rangeValue = Math.max(0, Math.min(1, rangeValue));
        let value = rangeValue**this.exponent * (this.maxVal - this.minVal) + this.minVal;
        value = Math.max(this.minVal, Math.min(this.maxVal, value));
        if (this.double) {
            let dist1 = Math.abs(value - this.handle1.value);
            let dist2 = Math.abs(value - this.handle2.value);
            if (dist1 < dist2) {
                this.positionHandle(this.handle1, rangeValue);
                this.handle1.value = value;
                this.minContainer.innerText = value.toFixed(this.decimalPlaces);

            } else {
                this.positionHandle(this.handle2, rangeValue);
                this.handle2.value = value;
                this.maxContainer.innerText = value.toFixed(this.decimalPlaces);
            }
        } else {
            this.value = value;
            this.positionHandle(this.handle1, rangeValue);
            this.handle1.value = value;
            this.maxContainer.innerText = value.toFixed(this.decimalPlaces);
        }
    }

    positionHandle(handle, value) {
        handle.style.left = `${this.sliderLineContainer.offsetLeft + value * this.sliderLineContainer.clientWidth - handle.offsetWidth / 2}px`;
    }

    dispatch() {
        document.dispatchEvent(new CustomEvent(`${this.domElement.id}-changed`, { detail: this.double ? [this.handle1.value, this.handle2.value] : this.value }));
    }
}

class InputField {
    holdingControl = false;
    constructor(containerDomElement) {
        this.domElement = containerDomElement;

        if (!this.domElement.id) {
            throw new Error("Input field must have an ID");
        }

        this.setupHTML();
        this.setupListeners();
    }

    setupHTML() {
        this.inputElement = document.createElement("div");
        this.inputElement.style.whiteSpace = "pre-wrap";
        this.domElement.appendChild(this.inputElement);

        this.placeholderElement = document.createElement("div");
        this.placeholderElement.innerText = "e.g. Ljubljana...";
        this.placeholderElement.style.whiteSpace = "pre-wrap";
        this.domElement.appendChild(this.placeholderElement);
    }

    setupListeners() {
        document.addEventListener("keydown", async (e) => {

            if (e.key === "Backspace") {
                this.inputElement.innerText = this.inputElement.innerText.slice(0, -1);
            } else if (e.key === "Enter") {
                this.dispatch();
                this.inputElement.innerText = "";
            } else if (e.key === "Escape") {
                this.inputElement.innerText = "";
            } else if (e.key === "Control") {
                this.holdingControl = true;
            }
            else if (e.key.length === 1) {
                // const charCode = e.which || e.keyCode;
                // if ((charCode >= 'a'.charCodeAt(0) && charCode <= 'z'.charCodeAt(0)) || (charCode >= 'A'.charCodeAt(0) && charCode <= 'Z'.charCodeAt(0))) {
                    this.inputElement.innerText += e.key;
                // }
            }

            if (this.inputElement.innerText.length > 0) {
                this.placeholderElement.classList.add("invisible");
            } else {
                this.placeholderElement.classList.remove("invisible");
            }
        });
    }

    dispatch() {
        document.dispatchEvent(new CustomEvent(`${this.domElement.id}-entered`, { detail: this.inputElement.innerText }));
    }
}