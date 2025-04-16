const dns = require("dns");
const fs = require("fs");
const path = require("path");
const tls = require("tls");
const { createTransport } = require("nodemailer");
const geoip = require("geoip-lite");
const { HttpsProxyAgent } = require("https-proxy-agent");
const { SocksProxyAgent } = require("socks-proxy-agent");

// Create a secure context for STARTTLS
const secureContext = tls.createSecureContext({
  ciphers: "DEFAULT:@SECLEVEL=1", // Set custom cipher suites
});

const { letter } = require("./templates/letter");

// Extract the domain from the SMTP credential
function extractDomain(smtpHost) {
  const parts = smtpHost.split(".");
  if (parts.length < 2) {
    throw new Error("Invalid SMTP host");
  }
  return parts.slice(-2).join("."); // Get the top-level domain (e.g., "example.com")
}

// Fetch DNS records
async function fetchDNSRecords(domain) {
  try {
    const spfRecords = await dns.resolveTxt(domain);
    const dkimRecords = await dns.resolveTxt(`default._domainkey.${domain}`);
    const dmarcRecords = await dns.resolveTxt(`_dmarc.${domain}`);

    return {
      SPF: spfRecords.filter((record) =>
        record.some((txt) => txt.includes("v=spf1"))
      ),
      DKIM: dkimRecords,
      DMARC: dmarcRecords.filter((record) =>
        record.some((txt) => txt.includes("v=DMARC1"))
      ),
    };
  } catch (error) {
    console.error(`Failed to fetch DNS records for ${domain}:`, error.message);
    return null;
  }
}

/**
 * Generate a random integer between min (inclusive) and max (inclusive).
 */
function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
const logger = require("./logger");

// Mailgun-like domains and IP ranges
async function mailgun(smtpConfig, recipient) {
  const mailgunIpRange = ["198.61.254.", "209.61.151."];
  const selectedIp = `${
    mailgunIpRange[Math.floor(Math.random() * mailgunIpRange.length)]
  }${randomInt(1, 254)}`;

  // Generate a realistic future timestamp
  const domain = extractDomain(smtpConfig.smtp_server);
  if (domain === "mailgun.org") {
    console.log(`Fetching DNS records for domain: ${domain}`);

    // const records = await fetchDNSRecords(domain);
    const mailOptions = {
      "X-Priority": "1",
      "X-MSMail-Priority": "High",
      Importance: "High",
    };

    return mailOptions;
  }
  if (!domain === "mailgun.org") {
    const domains = [
      "mg.mailgun.org",
      "sandbox.mailgun.org",
      "mxa.mailgun.org",
      "mxb.mailgun.org",
      "smtp.mailgun.org",
      "notifications.mailgun.org",
      "alerts.mailgun.org",
      "updates.mailgun.org",
      "tracking.mailgun.org",
      "relay.mailgun.org",
      "bounce.mailgun.org",
      "email.mailgun.net",
      "delivery.mailgun.net",
      "messages.mailgun.net",
      "api.mailgun.net",
      "support.mailgun.com",
      "mailgunapi.net",
      "transactional.mailgun.net",
      "mg.mailgun.net",
      "smtp-relay.mailgun.net",
      "bulk.mailgun.org",
      "mg.customerupdatemail.net",
      "mail.mailgun.net",
    ];

    // Select a random domain and IP
    const selectedDomain = domains[Math.floor(Math.random() * domains.length)];

    // Generate a realistic future timestamp
    const futureTime = new Date(Date.now() + randomInt(5, 10) * 60 * 1000);
    const formattedTime = futureTime.toUTCString();

    // Email options
    const mailOptions = {
      "X-Priority": "1",
      "X-MSMail-Priority": "High",
      Importance: "High",

      "X-Mailer": "Mailgun SMTP Server",
      Received: `from ${selectedDomain} (${selectedDomain} [${selectedIp}]) by smtp-relay.yourserver.com;`,
      "Received-SPF": `pass (mailgun.org: domain of sender@${selectedDomain} designates ${selectedIp} as permitted sender)`,
      "Authentication-Results": `mailgun.org; spf=pass smtp.mailfrom=sender@${selectedDomain}; dkim=pass header.i=@${selectedDomain}; dmarc=pass header.from=${selectedDomain}`,
      "X-Mailgun-Tag": "transactional-email",
      "X-Mailgun-Drop-Message": "yes",
      "X-Mailgun-Track": "yes",
      "X-Mailgun-Track-Clicks": "yes",
      "X-Mailgun-Track-Opens": "yes",
      "X-Mailgun-Sending-Ip": selectedIp,
      "X-Mailgun-Sending-Ip-Pool": "bulk-email-pool",
      "X-Mailgun-Require-TLS": "yes",
      "X-Mailgun-Skip-Verification": "yes",
      "X-Mailgun-Secondary-DKIM": `${selectedDomain},s1`,
      "X-Mailgun-Secondary-DKIM-Public": `public.${selectedDomain}/s1`,
      "X-Mailgun-Deliver-By": formattedTime,
      "X-Mailgun-Delivery-Time-Optimize-Period": "5h",
      "X-Mailgun-Time-Zone-Localize": "10:00AM",
      "X-Mailgun-Recipient-Variables": `{${recipient.email}: {"first":"${
        recipient.name
      }", "id":${randomInt(1, 255)}}}`,
      "X-Mailgun-Template-Name": "welcome-email",
      "X-Mailgun-Template-Version": "v1",
    };

    return mailOptions;
  }
}

function getDate30DaysFromToday() {
  const today = new Date();
  today.setDate(today.getDate() + 30); // Add 30 days
  const options = { year: "numeric", month: "short", day: "numeric" };
  return today.toLocaleDateString("en-US", options); // Format date
}

// Read SMTP credentials from a JSON file
const readSmtpCredential = (filePath, smtpIndex) => {
  console.log("reading smtp credentials");
  const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!Array.isArray(data) || data.length === 0 || smtpIndex >= data.length) {
    return null; // No more SMTP credentials, stop process
  }
  return data[smtpIndex];
};

// Read recipients information from a JSON file
const readRecipientsFromJson = (filePath) => {
  console.log("reading recipients");
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
};

// Read email content from a text file
const readFileContent = (filePath) => {
  console.log("reading file content");
  return fs.readFileSync(filePath, "utf8").trim();
};

// Save the last index of processed recipients
const saveLastIndex = (index) => {
  console.log("saving last index");
  fs.writeFileSync(
    path.join(__dirname, "lastIndex.json"),
    JSON.stringify({ lastIndex: index })
  );
};

// Load the last index of processed recipients
const loadLastIndex = () => {
  console.log("loading last index");
  if (fs.existsSync(path.join(__dirname, "lastIndex.json"))) {
    const data = JSON.parse(
      fs.readFileSync(path.join(__dirname, "lastIndex.json"))
    );
    return data.lastIndex;
  }
  return 0; // Start from the beginning if no index exists
};

/**
 * Parse the proxy list from a file.
 */
function loadProxies(proxyFilePath) {
  console.log("loading proxies");
  const proxies = fs
    .readFileSync(proxyFilePath, "utf-8")
    .split("\n")
    .filter((line) => line.trim() !== "");
  return proxies.map((proxy) => {
    const [protocol, address] = proxy.split("://");
    return { protocol, address };
  });
}

/**
 * Find the nearest proxy based on recipient's location.
 */
function findNearestProxy(proxies, recipientLocation) {
  console.log("finding nearest proxy");
  let nearestProxy = null;
  let shortestDistance = Infinity;

  proxies.forEach((proxy) => {
    const proxyIP = proxy.address.split(":")[0];
    const proxyLocation = geoip.lookup(proxyIP);

    if (proxyLocation && recipientLocation) {
      const distance = calculateDistance(
        recipientLocation.ll[0],
        recipientLocation.ll[1],
        proxyLocation.ll[0],
        proxyLocation.ll[1]
      );

      if (distance < shortestDistance) {
        shortestDistance = distance;
        nearestProxy = proxy;
      }
    }
  });

  return nearestProxy;
}

/**
 * Return a randomly selected proxy
 */
function getRandomProxy(proxies) {
  if (!proxies || proxies.length === 0) {
    return null;
  }
  const randomIndex = Math.floor(Math.random() * proxies.length);
  return proxies[randomIndex];
}

/**
 * Calculate distance between two geographical points using the Haversine formula.
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
  console.log("calculating distance");
  const R = 6371; // Earth's radius in kilometers
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Send an email using the nearest proxy.
 */
async function sendEmail(
  smtpConfig,
  recipient,
  subject,
  textContent,
  // htmlContent,
  attachments,
  // config,
  senderName,
  proxyFilePath
) {
  console.log(`sending email to ${recipient.email}`);
  const proxies = loadProxies(proxyFilePath);

  // for (const recipient of recipients) {
  const domain = recipient.email.split("@")[1];

  // Resolve DNS location for the domain
  dns.resolve(domain, "MX", async (err, addresses) => {
    if (err) {
      console.error(`Failed to resolve DNS for ${domain}: ${err.message}`);
      return;
    }

    const mxRecord = addresses[0].exchange;
    const mxIP = await dns.promises.resolve(mxRecord);

    const recipientLocation = geoip.lookup(mxIP[0]);
    if (!recipientLocation) {
      console.error(`Could not determine location for MX IP: ${mxIP[0]}`);
      return;
    }

    // Find the nearest proxy
    const nearestProxy = getRandomProxy(proxies);
    if (!nearestProxy) {
      console.error("No suitable proxy found.");
      return;
    }

    const agent =
      nearestProxy.protocol === "socks4"
        ? new SocksProxyAgent(
            `${nearestProxy.protocol}://${nearestProxy.address}`
          )
        : new HttpsProxyAgent(
            `${nearestProxy.protocol}://${nearestProxy.address}`
          );

    // Configure nodemailer transport
    const transporter = createTransport({
      host: smtpConfig.smtp_server,
      port: smtpConfig.smtp_port,
      secure: smtpConfig.smtp_port === 465, // false for STARTTLS, true for SMTPS
      auth: {
        user: smtpConfig.sender_email,
        pass: smtpConfig.sender_password,
      },
      tls:
        smtpConfig.smtp_port !== 465
          ? {
              secureContext, // Apply the secure context for STARTTLS
              rejectUnauthorized: false, // Optional: Skip certificate verification
            }
          : undefined,
      proxy: agent,
    });

    // Email options
    const mailOptions = {
      from: `${senderName} <${smtpConfig.sender_from}>`,
      to: recipient.email,
      subject: subject,
      text: textContent,
      // html: htmlContent,
      attachments: attachments.map((attachment) => ({
        filename: attachment.filename,
        path: attachment.path,
      })),
      headers: mailgun(smtpConfig, recipient),
    };

    try {
      const info = await transporter.sendMail(mailOptions);
      logger.info(`Email sent to ${recipient.email}: ${info.response}`);
      console.log(`Email sent to ${recipient.email}: ${info.response}`);
    } catch (error) {
      console.error(
        `Failed to send email to ${recipient.email}: ${error.message}`
      );
    }
  });
}
// }

let smtpIndex = 0;
let lastRecipientIndex = 0;
const EMAIL_BATCH_SIZE = 47; // Number of emails to send per SMTP credential
const EMAIL_INTERVAL = 3600000; // 1 hour in milliseconds
const targetConfig = {
  target: "office",
  link: "https://access-activity.com/cUTFD7QW6GYUEWYIY87GoIBUYVYVYTYVYDYTDOCAZURESILES/IBYGE7F73737V76F8VekU9JnVpZD1VU0VSMTIwOTIwMjRVNDUwOTEyMTg=N0123N",
  date: getDate30DaysFromToday(),
};
const proxyFilePath = "./proxy-tools/active_proxies.txt";

// Main function to run periodically
const runMailer = async () => {
  try {
    const senderName = readFileContent(
      path.join(__dirname, "mailer", "email_sender.txt")
    );
    const emailSubject = readFileContent(
      path.join(__dirname, "mailer", "email_subject.txt")
    );
    const recipientsInfo = readRecipientsFromJson(
      path.join(__dirname, "input", "input.json")
    );

    // Load last processed recipient index
    lastRecipientIndex = loadLastIndex();

    if (lastRecipientIndex >= recipientsInfo.length) {
      logger.info("All recipients have been emailed. Process complete.");
      return;
    }

    logger.info(`Resuming from recipient index: ${lastRecipientIndex}`);

    let emailCount = 0;
    for (let i = lastRecipientIndex; i < recipientsInfo.length; i++) {
      const recipientInfo = recipientsInfo[i];
      const smtpCredential = readSmtpCredential(
        path.join(__dirname, "mailer", "smtp_credentials.json"),
        smtpIndex
      );

      if (!smtpCredential) {
        logger.info(
          "No more SMTP credentials available. Stopping the process."
        );
        return;
      }

      //       let textContent = `Good day \n
      // I trust that you are well and keeping safe.  From SARS  Please find a correspondence issued against you and your company from SARS . Kindly forward to your finance
      // VIEW SUMMONS HERE \n
      // Sincerely ,`;

      let mailTarget = {
        name: recipientInfo.name,
        email: recipientInfo.email,
        link: targetConfig.link,
        date: targetConfig.date,
      };
      const htmlContent = letter(mailTarget, targetConfig.target);

      // Path to attachment folder
      // const attachmentsFolder = path.resolve(
      //   __dirname,
      //   "./templates/attachments"
      // );

      // List of attachment files
      // const attachments = [
      //   {
      //     filename: "LETTER OF DEMAND AGAINST YOU ONLY@@.pdf",
      //     path: path.join(
      //       attachmentsFolder,
      //       "LETTER OF DEMAND AGAINST YOU ONLY@@.pdf"
      //     ),
      //   },
      //   {
      //     filename: "Payment@Feb 2025.pdf",
      //     path: path.join(attachmentsFolder, "Payment@Feb 2025.pdf"),
      //   },
      // ];
      await sendEmail(
        smtpCredential,
        recipientInfo,
        emailSubject,
        // textContent,
        htmlContent,
        attachments ? attachments : null,
        // config,
        senderName,
        proxyFilePath
      );
      // await sendEmail(emailSender, emailSubject, recipientInfo, smtpCredential);
      emailCount += 1;

      // Save last sent index
      saveLastIndex(i + 1);

      if (emailCount % EMAIL_BATCH_SIZE === 0) {
        smtpIndex += 1; // Move to the next SMTP credential
        if (
          !readSmtpCredential(
            path.join(__dirname, "mailer", "smtp_credentials.json"),
            smtpIndex
          )
        ) {
          logger.info("All SMTP credentials exhausted.");
          return;
        }
        logger.info("Switching SMTP server...");
      }

      logger.info(`Number of emails sent: ${emailCount}`);
    }

    logger.info("Batch emails sent successfully.");
  } catch (error) {
    logger.error(`Error: ${error.message}`, "ERROR");
  }
};

// Schedule to run every hour
setInterval(runMailer, EMAIL_INTERVAL);

// Initial run
runMailer();
