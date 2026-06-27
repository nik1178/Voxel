import cityData from "./map/slovenian_cities.json" with { type: "json" };

export class CommandConverter {
    constructor() {
        this.cityData = cityData;
    }
    getPosition(command) {
        // const parts = command.split(" ");
        // if (parts[0] === "tp") {
        //     const x = parseFloat(parts[1]);
        //     const y = parseFloat(parts[2]);
        //     const z = parseFloat(parts[3]);
        //     return vec3.fromValues(x, y, z);
        // }
        // return null;
        // console.log(this.areCoords("46°04'11.5\"N 14°30'17.4\"E"));

        const city = this.getCity(command);
        if(city) {
            return this.coordinatesToPosition(city.coordinates);
        }
    }

    areCoords(str) {
        const regex = /^-?\d+(\.\d+)?°\s*-?\d+(\.\d+)?'\s*-?\d+(\.\d+)?("|\"\"\s*[NSEW])\s+-?\d+(\.\d+)?°\s*-?\d+(\.\d+)?'\s*-?\d+(\.\d+)?("|\"\"\s*[NSEW])$/;
        
        if(regex.test(str)) {
            str.replace(/"/g, "");
            str.replace(/'/g, "");
            str.replace(/°/g, "");
            str.replace(/\s/g, "");
            console.log(str);
        }
        return false;
    }

    getCity(name) {
        for(let city of this.cityData) {
            if(city.name.toLowerCase().trim() === name.toLowerCase().trim()) {
                return city;
            }
        }
        return null;
    }

    // Ljubljanski Grad - 46.048896924867655, 14.50855400603569  ==  -40971.0, 383.1, 70124.8
    // Murska sobota lake corner - 46.64568503564848, 16.16858812086297 ==  -168453.8, 197.1, 137003.6

    coordinatesToPosition(coords) {
        const lat1 = 46.048896924867655;
        const lng1 = 14.50855400603569;
        const x1 = -40971.0;
        const z1 = 70124.8;

        const lat2 = 46.64568503564848;
        const lng2 = 16.16858812086297;
        const x2 = -168453.8;
        const z2 = 137003.6;

        let x = (coords.lng - lng1) / (lng2 - lng1) * (x2 - x1) + x1;
        let z = (coords.lat - lat1) / (lat2 - lat1) * (z2 - z1) + z1;
        
        // Assuming vec3 or array is expected. Using 500 for a safe Y height default
        return [x, 50000, z];
    }
}