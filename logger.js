const winston = require("winston");
require("winston-daily-rotate-file");

// Set up log levels and their colors
const logLevels = {
  levels: {
    info: 0,
    warn: 1,
    error: 2,
  },
  colors: {
    info: "green",
    warn: "yellow",
    error: "red",
  },
};

// Initialize the logger with daily rotation
const dailyRotateFileTransport = new winston.transports.DailyRotateFile({
  filename: "logs/%DATE%-app.log", // Log file will include the current date
  datePattern: "YYYY-MM-DD", // Format of the date in the filename
  maxSize: "20m", // Maximum file size before rotating to a new file
  maxFiles: "14d", // Keep logs for the last 14 days, then delete older logs
  level: "info", // Only log info-level and higher messages to this file
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json() // Store logs in JSON format
  ),
});

const errorRotateFileTransport = new winston.transports.DailyRotateFile({
  filename: "logs/%DATE%-error.log", // Log errors in a separate file
  datePattern: "YYYY-MM-DD",
  maxSize: "20m",
  maxFiles: "14d",
  level: "error", // Only log error-level messages to this file
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json() // Store error logs in JSON format
  ),
});

// Set up the console transport for logging to the console
const consoleTransport = new winston.transports.Console({
  level: "info", // Log to console with info-level and higher
  format: winston.format.combine(
    winston.format.colorize(), // Colorize console output
    winston.format.simple() // Simple text format for console output
  ),
});

// Create the logger instance
const logger = winston.createLogger({
  levels: logLevels.levels,
  transports: [
    // Log to the console
    consoleTransport,
    // Log to the daily rotated log file (app.log)
    dailyRotateFileTransport,
    // Log errors to the error.log file
    errorRotateFileTransport,
  ],
  exitOnError: false, // Do not terminate the process on fatal errors
});

// Add custom colors to the logger
winston.addColors(logLevels.colors);

// Export the logger for use throughout the app
module.exports = logger;
