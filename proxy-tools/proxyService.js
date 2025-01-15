const axios = require("axios");
const path = require("path");
const fs = require("fs");
const net = require("net");
const { SocksProxyAgent } = require("socks-proxy-agent");
const logger = require("../logger");

const proxySources = [
  { url: "https://www.sslproxies.org/", type: "http" },
  { url: "https://free-proxy-list.net/", type: "http" },
  { url: "https://www.us-proxy.org/", type: "http" },
  { url: "https://socks-proxy.net/", type: "socks4" },
  { url: "https://www.proxyscrape.com/free-proxy-list", type: "socks5" },
  { url: "http://spys.one/en/socks-proxy-list/", type: "socks5" },
  { url: "https://www.proxy-list.download/SOCKS4", type: "socks4" },
  { url: "https://www.proxy-list.download/SOCKS5", type: "socks5" },
  { url: "https://www.my-proxy.com/free-socks-5-proxy.html", type: "socks5" },
  {
    url: "http://free-proxy.cz/en/proxylist/country/all/socks/ping/all/",
    type: "socks5",
  },
];

const proxyRegex = /(\d+\.\d+\.\d+\.\d+):(\d+)/g;
const filename = path.join(__dirname, "active_proxies.txt");

// Fetch proxies from a URL
async function fetchProxies(url, proxyType) {
  try {
    const response = await axios.get(url, { timeout: 10000 });
    const proxies = Array.from(response.data.matchAll(proxyRegex), (match) =>
      match.slice(1, 3)
    );
    logger.info(`Fetched ${proxies.length} proxies from ${url} (${proxyType})`);
    console.log(`Fetched ${proxies.length} proxies from ${url} (${proxyType})`);
    return proxies.map((proxy) => ({
      ip: proxy[0],
      port: proxy[1],
      type: proxyType,
    }));
  } catch (error) {
    logger.error(`Error fetching proxies from ${url}: ${error.message}`);
    console.error(`Error fetching proxies from ${url}: ${error.message}`);
    return [];
  }
}

// Test proxy connectivity
function testProxy(proxy) {
  return new Promise((resolve) => {
    const { ip, port, type } = proxy;
    if (type.startsWith("socks")) {
      const agent = new SocksProxyAgent(`${type}://${ip}:${port}`);
      axios
        .get("http://httpbin.org/ip", { httpAgent: agent, timeout: 5000 })
        .then(() => resolve(true))
        .catch(() => resolve(false));
    } else {
      const client = net.createConnection({
        host: ip,
        port: parseInt(port),
        timeout: 5000,
      });
      client.on("connect", () => {
        client.end();
        resolve(true);
      });
      client.on("error", () => resolve(false));
      client.on("timeout", () => {
        client.destroy();
        resolve(false);
      });
    }
  });
}

// Save active proxies to a file
function saveProxy(proxy) {
  const line = `${proxy.type}://${proxy.ip}:${proxy.port}\n`;
  fs.appendFileSync(filename, line);
}

// Main function to fetch, test, and save proxies
async function runProxyFinder() {
  console.log("Starting Proxy Finder...");

  let allProxies = [];
  for (const { url, type } of proxySources) {
    const proxies = await fetchProxies(url, type);
    allProxies = allProxies.concat(proxies);
  }

  console.log(`Total proxies fetched: ${allProxies.length}`);
  allProxies = allProxies.sort(() => 0.5 - Math.random()); // Shuffle proxies

  console.log("Testing proxies...");
  const promises = allProxies.map(async (proxy) => {
    const isActive = await testProxy(proxy);
    if (isActive) {
      logger.info(
        `Active proxy found: ${proxy.type}://${proxy.ip}:${proxy.port}`
      );
      console.log(
        `Active proxy found: ${proxy.type}://${proxy.ip}:${proxy.port}`
      );
      saveProxy(proxy);
    }
  });

  await Promise.all(promises);
  logger.info(
    "Proxy fetching and testing complete. Active proxies saved in txt file."
  );
  console.log(
    "Proxy fetching and testing complete. Active proxies saved in txt file."
  );
}

// Exported functions
// module.exports = {
//   fetchProxies,
//   testProxy,
//   saveProxy,
//   runProxyFinder,
// };

runProxyFinder();
