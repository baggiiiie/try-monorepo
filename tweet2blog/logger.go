package main

import (
	"fmt"
	"log"
)

// Logger provides structured logging
type Logger struct {
	verbose bool
}

// NewLogger creates a new logger
func NewLogger(verbose bool) *Logger {
	return &Logger{verbose: verbose}
}

// Info logs an info message
func (l *Logger) Info(format string, args ...interface{}) {
	if l.verbose {
		log.Printf("[INFO] "+format, args...)
	}
}

// Warn logs a warning message
func (l *Logger) Warn(format string, args ...interface{}) {
	log.Printf("[WARN] "+format, args...)
}

// Error logs an error message
func (l *Logger) Error(format string, args ...interface{}) {
	log.Printf("[ERROR] "+format, args...)
}

// Debugf logs a debug message
func (l *Logger) Debugf(format string, args ...interface{}) {
	if l.verbose {
		fmt.Printf("[DEBUG] "+format+"\n", args...)
	}
}
