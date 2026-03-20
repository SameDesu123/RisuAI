// Test for custom transport
import { MCPClient } from './src/ts/process/mcp/mcplib';

const client = new MCPClient('dummy');
client.customTransport = {
    send: async () => {
        throw new Error('Test send error');
    },
    addListener: () => {},
    removeListener: () => {}
};

client.request('test').then(res => {
    console.log(JSON.stringify(res, null, 2));
}).catch(err => {
    console.error('Caught error:', err);
});
