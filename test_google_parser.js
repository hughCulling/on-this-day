const fs = require('fs');
const jsdom = require("jsdom");
const { JSDOM } = jsdom;

// Mock the DOM environment for the parser
const dom = new JSDOM(`<!DOCTYPE html><p>Hello world</p>`);
global.DOMParser = dom.window.DOMParser;
global.document = dom.window.document;

// Load the parser
const parserCode = fs.readFileSync('parsers/google.js', 'utf8');
eval(parserCode);

async function run() {
    const filePath = '/Users/hughculling/Documents/Personal Data/Started on 2026:02:27/Google/Takeout-2/My Activity/Search/MyActivity.html';
    const text = fs.readFileSync(filePath, 'utf8');
    
    // Mock the File object that parseFiles expects
    const mockFile = {
        name: 'MyActivity.html',
        webkitRelativePath: 'Takeout/My Activity/Search/MyActivity.html',
        text: async () => text
    };
    
    console.log("Starting parse...");
    const events = await GoogleParser.parseFiles([mockFile], null, null);
    
    console.log(`Parsed ${events.length} events.`);
    if (events.length > 0) {
        console.log("First event:", events[0]);
        console.log("Last event:", events[events.length - 1]);
    }
}

run().catch(console.error);
