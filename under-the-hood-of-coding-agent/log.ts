export function log(label: string, data: any) {
    console.log(`<${label}>`);
    if (typeof data === "string") {
        console.log(data);
    } else {
        console.log(JSON.stringify(data, null, 2));
    }
    console.log(`</${label}>`);
}
