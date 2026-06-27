import cityData from "./map/slovenian_cities.json" with { type: "json" };

export class CommandConverter {
    constructor() {
        this.cityData = cityData;
    }
    getPosition(command) {
        // 1. Check if it's already decimal coordinates (e.g. 46.048896, 14.508554)
        const decimalMatch = command.match(/^(-?\d+(\.\d+)?)\s*,\s*(-?\d+(\.\d+)?)$/);
        if (decimalMatch) {
            const coords = {
                lat: parseFloat(decimalMatch[1]),
                lng: parseFloat(decimalMatch[3])
            };
            return this.coordinatesToPosition(coords);
        }

        // 2. Check if it's DMS coordinates
        if (this.areCoords(command)) {
            console.log("Those sure DO look like coords!");
            const coords = this.dmsToDecimal(command);
            if (coords) {
                return this.coordinatesToPosition(coords);
            }
        }

        // 3. Fallback to city name
        const city = this.getCity(command);
        if(city) {
            return this.coordinatesToPosition(city.coordinates);
        }
        
        return null;
    }

    dmsToDecimal(dmsStr) {
        // Extract all numbers and direction letters
        const matches = dmsStr.match(/(-?\d+(\.\d+)?)|([NSEW])/gi);
        if (!matches || matches.length < 6) return null;

        console.log("Matches: ", matches);
        
        let i = 0;

        // Parse Latitude
        let deg1 = parseFloat(matches[i++]);
        let min1 = parseFloat(matches[i++]);
        let sec1 = parseFloat(matches[i++]);
        let dir1 = (matches[i] && matches[i].match(/[NSEW]/i)) ? matches[i++].toUpperCase() : null;

        let lat = Math.abs(deg1) + min1 / 60 + sec1 / 3600;
        if (deg1 < 0 || dir1 === 'S') lat = -lat;

        // Parse Longitude
        let deg2 = parseFloat(matches[i++]);
        let min2 = parseFloat(matches[i++]);
        let sec2 = parseFloat(matches[i++]);
        let dir2 = (matches[i] && matches[i].match(/[NSEW]/i)) ? matches[i++].toUpperCase() : null;

        let lng = Math.abs(deg2) + min2 / 60 + sec2 / 3600;
        if (deg2 < 0 || dir2 === 'W') lng = -lng;

        return { lat, lng };
    }

    areCoords(str) {
        // Fixed regex:
        const regex = /^-?\d+(\.\d+)?°\s*-?\d+(\.\d+)?'\s*-?\d+(\.\d+)?("|'')\s*[NSEW]?\s+-?\d+(\.\d+)?°\s*-?\d+(\.\d+)?'\s*-?\d+(\.\d+)?("|'')\s*[NSEW]?$/;

        if(regex.test(str)) {
            str.replace(/"/g, "");
            str.replace(/'/g, "");
            str.replace(/°/g, "");
            str.replace(/\s/g, "");
            return true;
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