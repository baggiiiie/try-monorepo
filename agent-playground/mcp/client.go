package mcp

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"sync"
)

type Client struct {
	Name    string
	command string
	args    []string
	cmd     *exec.Cmd
	stdin   io.WriteCloser
	reader  *bufio.Reader
	mu      sync.Mutex
	nextID  int64
}

type ToolDef struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	InputSchema map[string]any `json:"inputSchema"`
}

type ContentItem struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

type CallResult struct {
	Content []ContentItem `json:"content"`
	IsError bool          `json:"isError"`
}

type jsonrpcRequest struct {
	JSONRPC string `json:"jsonrpc"`
	ID      int64  `json:"id"`
	Method  string `json:"method"`
	Params  any    `json:"params,omitempty"`
}

type jsonrpcNotification struct {
	JSONRPC string `json:"jsonrpc"`
	Method  string `json:"method"`
}

type jsonrpcResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      *int64          `json:"id"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *jsonrpcError   `json:"error,omitempty"`
}

type jsonrpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

func NewClient(name, command string, args []string) *Client {
	return &Client{
		Name:    name,
		command: command,
		args:    args,
	}
}

func (c *Client) Start() error {
	c.cmd = exec.Command(c.command, c.args...)
	c.cmd.Stderr = os.Stderr

	var err error
	c.stdin, err = c.cmd.StdinPipe()
	if err != nil {
		return fmt.Errorf("stdin pipe: %w", err)
	}

	stdout, err := c.cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("stdout pipe: %w", err)
	}
	c.reader = bufio.NewReader(stdout)

	if err := c.cmd.Start(); err != nil {
		return fmt.Errorf("start process: %w", err)
	}
	return nil
}

// Initialize performs the handshake with the MCP server to establish a connection.
func (c *Client) Initialize() error {
	params := map[string]any{
		"protocolVersion": "2025-03-26",
		"capabilities":    map[string]any{},
		"clientInfo": map[string]any{
			"name":    "agent-playground",
			"version": "1.0.0",
		},
	}

	_, err := c.request("initialize", params)
	if err != nil {
		return fmt.Errorf("initialize: %w", err)
	}

	return c.notify("notifications/initialized")
}

// ListTools returns the list of tools available on the MCP server.
// Part of the handshake in MCP
func (c *Client) ListTools() ([]ToolDef, error) {
	raw, err := c.request("tools/list", nil)
	if err != nil {
		return nil, fmt.Errorf("tools/list: %w", err)
	}

	var result struct {
		Tools []ToolDef `json:"tools"`
	}
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, fmt.Errorf("parse tools/list result: %w", err)
	}
	return result.Tools, nil
}

// CallTool sends a JSON RPC request to the MCP server to execute a tool.
func (c *Client) CallTool(name string, arguments map[string]any) (*CallResult, error) {
	params := map[string]any{
		"name":      name,
		"arguments": arguments,
	}

	raw, err := c.request("tools/call", params)
	if err != nil {
		return nil, fmt.Errorf("tools/call: %w", err)
	}

	var result CallResult
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, fmt.Errorf("parse tools/call result: %w", err)
	}
	return &result, nil
}

func (c *Client) Close() error {
	c.stdin.Close()
	c.cmd.Process.Kill()
	return c.cmd.Wait()
}

// request sends a JSON-RPC request to the MCP server, basically writting to stdin.
func (c *Client) request(method string, params any) (json.RawMessage, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.nextID++
	id := c.nextID

	req := jsonrpcRequest{
		JSONRPC: "2.0",
		ID:      id,
		Method:  method,
		Params:  params,
	}

	data, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}
	data = append(data, '\n')

	if _, err := c.stdin.Write(data); err != nil {
		return nil, fmt.Errorf("write request: %w", err)
	}

	const maxIterations = 10
	for range maxIterations {
		line, err := c.reader.ReadBytes('\n')
		if err != nil {
			return nil, fmt.Errorf("read response: %w", err)
		}

		var resp jsonrpcResponse
		if err := json.Unmarshal(line, &resp); err != nil {
			continue
		}

		if resp.ID == nil {
			continue
		}

		if *resp.ID != id {
			continue
		}

		if resp.Error != nil {
			return nil, fmt.Errorf("rpc error %d: %s", resp.Error.Code, resp.Error.Message)
		}

		return resp.Result, nil
	}

	return nil, fmt.Errorf("no response received after %d lines", maxIterations)
}

func (c *Client) notify(method string) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	notif := jsonrpcNotification{
		JSONRPC: "2.0",
		Method:  method,
	}

	data, err := json.Marshal(notif)
	if err != nil {
		return fmt.Errorf("marshal notification: %w", err)
	}
	data = append(data, '\n')

	if _, err := c.stdin.Write(data); err != nil {
		return fmt.Errorf("write notification: %w", err)
	}
	return nil
}
