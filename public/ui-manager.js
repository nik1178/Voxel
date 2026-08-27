export class UIManager {
    visible = true;

    constructor() {
        this.setupListeners();
    }

    setupListeners() {
        if (window.matchMedia("(pointer: coarse)").matches) {
            document.body.classList.add("touch");
        }

        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape") {
                e.preventDefault();
                this.toggleUI();
            }
        });

        const uiToggleButton = document.getElementById("ui-toggle");
        if (uiToggleButton) {
            uiToggleButton.addEventListener("click", () => this.toggleUI());
        }

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
        this.chunkSizeSlider = new Slider(chunkSizeSlider, 2, 1000, false, 0, 2);
        const viewDistanceSlider = document.querySelector("#view-distance");
        this.viewDistanceSlider = new Slider(viewDistanceSlider, 0, 200000, false, 0, 5);
        const lodLimitsSlider = document.querySelector("#lod-limits");
        this.lodLimitsSlider = new Slider(lodLimitsSlider, 0, 9, true, 0);

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

    toggleUI() {
        const ui = document.getElementById("ui");
        ui.classList.toggle("invisible");
        document.body.focus();
        this.visible = !ui.classList.contains("invisible");
        document.body.classList.toggle("ui-hidden", !this.visible);
        const button = document.getElementById("ui-toggle");
        if (button) button.innerText = this.visible ? "✕" : "☰";
        document.dispatchEvent(new CustomEvent("ui-toggled", { detail: this.visible }));
    }

    // Make the DOM controls display the given state. Never dispatches events —
    // this reflects state, it does not cause it.
    applyState(state) {
        const renderTypeSelect = document.querySelector(".render-type-container select");
        if (renderTypeSelect && state.renderType !== undefined) renderTypeSelect.value = state.renderType;
        const strategySelect = document.querySelector(".chunk-strategy-container select");
        if (strategySelect && state.strategy !== undefined) strategySelect.value = state.strategy;
        if (state.fx !== undefined) this.setToggle("fx-toggle", state.fx);
        // The toggle's label is "RPC not Websockets": active means HTTP.
        if (state.sockets !== undefined) this.setToggle("socket-toggle", !state.sockets);
        if (state.culling !== undefined) this.setToggle("culling-toggle", state.culling);
        if (state.chunkSize !== undefined) this.chunkSizeSlider.setValue(state.chunkSize);
    }

    setToggle(id, active) {
        const el = document.getElementById(id);
        if (el) el.classList.toggle("active", !!active);
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
        this.domElement.addEventListener("pointerdown", (e) => {
            e.preventDefault();
            this.pressed = true;
            this.domElement.setPointerCapture(e.pointerId);
            this.updateHandles(e);
        });
        this.domElement.addEventListener("pointermove", (e) => {
            if (this.pressed) {
                this.updateHandles(e);
            }
        });
        const release = () => {
            if (this.pressed) {
                this.dispatch();
            }
            this.pressed = false;
        };
        this.domElement.addEventListener("pointerup", release);
        this.domElement.addEventListener("pointercancel", release);

        // Handle positions are absolute pixels; recompute them on resize.
        window.addEventListener("resize", () => this.reposition());
    }

    reposition() {
        const toRange = (v) => ((v - this.minVal) / (this.maxVal - this.minVal)) ** (1 / this.exponent);
        this.positionHandle(this.handle1, toRange(this.handle1.value));
        if (this.double) {
            this.positionHandle(this.handle2, toRange(this.handle2.value));
        }
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
        this.handle1.value = this.minVal;
        this.positionHandle(this.handle1, 0);

        if (this.double) {
            this.handle2 = document.createElement("div");
            this.handle2.classList.add("handle");
            this.domElement.appendChild(this.handle2);
            this.handle2.value = this.maxVal;
            this.positionHandle(this.handle2, 1);
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

    // Position the handle to show `value` without dispatching a change event.
    // Single-handle sliders only (double sliders are not needed by applyState).
    setValue(value) {
        if (this.double) return;
        value = Math.max(this.minVal, Math.min(this.maxVal, value));
        const rangeValue = ((value - this.minVal) / (this.maxVal - this.minVal)) ** (1 / this.exponent);
        this.value = value;
        this.handle1.value = value;
        this.positionHandle(this.handle1, rangeValue);
        this.maxContainer.innerText = value.toFixed(this.decimalPlaces);
    }
}

class InputField {
    visible = true;
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
            } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
                this.inputElement.innerText += e.key;
            }

            if (this.inputElement.innerText.length > 0) {
                this.placeholderElement.classList.add("invisible");
            } else {
                this.placeholderElement.classList.remove("invisible");
            }
        });

        document.addEventListener("paste", (e) => {
            const text = (e.clipboardData || window.clipboardData).getData("text");
            if (text) {
                this.inputElement.innerText += text;
                if (this.inputElement.innerText.length > 0) {
                    this.placeholderElement.classList.add("invisible");
                } else {
                    this.placeholderElement.classList.remove("invisible");
                }
            }
        });
    }

    dispatch() {
        document.dispatchEvent(new CustomEvent(`${this.domElement.id}-entered`, { detail: this.inputElement.innerText }));
    }
}