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