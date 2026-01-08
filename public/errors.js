function alertError(message) {
    alert("Error: " + message);
    console.error("Error: " + message);
    throw new Error(message);
}

export { alertError };