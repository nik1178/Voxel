export class UIManager {
    constructor() {
        this.setupListeners();
    }

    setupListeners() {
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

        // Sliders
        // const sliders = document.querySelectorAll(".slider");
        // sliders.forEach((slider) => {
        //     new Slider(slider, -1000, 1000, false);
        // });
        const chunkSizeSlider = document.querySelector("#chunk-size");
        new Slider(chunkSizeSlider, 2, 1000, false, 0);
        const viewDistanceSlider = document.querySelector("#view-distance");
        new Slider(viewDistanceSlider, 0, 200000, false, 0, 5);
        const lodLimitsSlider = document.querySelector("#lod-limits");
        new Slider(lodLimitsSlider, 0, 9, true, 0);

        // Render type dropdown
        const renderTypeSelect = document.querySelector(".render-type-container select");
        if (renderTypeSelect) {
            renderTypeSelect.addEventListener("change", (e) => {
                console.log("Changed render type to: ", e.target.value);
                document.dispatchEvent(new CustomEvent("render-type-changed", { detail: e.target.value }));

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