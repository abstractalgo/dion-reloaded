import { useState, useRef, useEffect, useCallback } from "react";
import Editor from "@monaco-editor/react";
import * as ts from "typescript";
import ReactJson from "react-json-view";
import { editor, MarkerSeverity } from "monaco-editor";

// Helper function to calculate maximum nesting depth
function calculateMaxNestingDepth(node: ts.Node): number {
  let maxDepth = 1; // Start from 1 to align with zoom levels

  function traverse(currentNode: ts.Node, currentDepth: number): void {
    // Check if this node introduces a new block scope
    const isBlockScope = isBlockScopeNode(currentNode);
    let nodeDepth = currentDepth;

    // Special handling for else-if chains: don't increment depth for else-if statements
    if (isBlockScope) {
      // Check if this is an else-if (IfStatement that's an elseStatement of another IfStatement)
      const parent = currentNode.parent;
      const isElseIf =
        currentNode.kind === ts.SyntaxKind.IfStatement &&
        parent &&
        parent.kind === ts.SyntaxKind.IfStatement &&
        (parent as ts.IfStatement).elseStatement === currentNode;

      if (!isElseIf) {
        nodeDepth = currentDepth + 1;
      }
    }

    maxDepth = Math.max(maxDepth, nodeDepth);

    // Traverse children
    currentNode.forEachChild((child) => {
      traverse(child, nodeDepth);
    });
  }

  traverse(node, 1); // Start from depth 1
  return maxDepth;
}

// Helper function to determine if a node introduces a block scope
function isBlockScopeNode(node: ts.Node): boolean {
  return [
    ts.SyntaxKind.FunctionDeclaration,
    ts.SyntaxKind.FunctionExpression,
    ts.SyntaxKind.ArrowFunction,
    ts.SyntaxKind.MethodDeclaration,
    ts.SyntaxKind.Constructor,
    ts.SyntaxKind.GetAccessor,
    ts.SyntaxKind.SetAccessor,
    // ts.SyntaxKind.Block, // Removed - blocks are containers, not scope creators
    ts.SyntaxKind.IfStatement,
    ts.SyntaxKind.ForStatement,
    ts.SyntaxKind.ForInStatement,
    ts.SyntaxKind.ForOfStatement,
    ts.SyntaxKind.WhileStatement,
    ts.SyntaxKind.DoStatement,
    ts.SyntaxKind.SwitchStatement,
    ts.SyntaxKind.CaseClause,
    ts.SyntaxKind.DefaultClause,
    ts.SyntaxKind.TryStatement,
    ts.SyntaxKind.CatchClause,
    ts.SyntaxKind.ClassDeclaration,
    ts.SyntaxKind.ModuleDeclaration,
    ts.SyntaxKind.EnumDeclaration,
    ts.SyntaxKind.InterfaceDeclaration,
  ].includes(node.kind);
}

// Canvas renderer for AST - renders actual TypeScript syntax
class ASTCanvasRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private sourceFile: ts.SourceFile | undefined = undefined;
  private lineHeight = 18;
  private fontSize = 14;

  // Configurable settings
  private indent = 20;
  private showBraces = true;
  private showSemicolons = true;

  // Syntax highlighting colors (light theme)
  private colors = {
    keyword: "#0000ff", // Blue for keywords (function, if, else, return, etc.)
    string: "#008000", // Green for strings
    number: "#ff6600", // Orange for numbers
    comment: "#808080", // Gray for comments
    identifier: "#333333", // Dark gray for identifiers/variables
    type: "#2b91af", // Blue-gray for types
    operator: "#333333", // Dark gray for operators
    punctuation: "#333333", // Dark gray for punctuation
    default: "#333333", // Default dark gray
  };

  // Pan and zoom state
  private zoomLevel = 1; // Discrete zoom level (1, 2, 3, etc.)
  private maxNestingDepth = 1;
  private wheelDelta = 0; // Accumulated wheel delta for smoother zooming
  private wheelThreshold = 100; // How much wheel delta needed to change zoom level
  private panX = 0;
  private panY = 0;
  private isPanning = false;
  private lastMouseX = 0;
  private lastMouseY = 0;

  // Callback for zoom changes
  private onZoomChange?: (zoomLevel: number) => void;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    this.setupHighDPICanvas();
    this.setupEventListeners();
  }

  private setupHighDPICanvas() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();

    // Set the actual size in memory (scaled for device pixel ratio)
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;

    // Scale the context to ensure correct drawing operations
    this.ctx.scale(dpr, dpr);

    // Set the display size (css pixels)
    this.canvas.style.width = rect.width + "px";
    this.canvas.style.height = rect.height + "px";
  }

  updateSettings(settings: {
    zoomLevel?: number;
    maxNestingDepth?: number;
    indent?: number;
    showBraces?: boolean;
    showSemicolons?: boolean;
  }) {
    if (settings.zoomLevel !== undefined) {
      this.zoomLevel = settings.zoomLevel;
    }
    if (settings.maxNestingDepth !== undefined) {
      this.maxNestingDepth = settings.maxNestingDepth;
    }
    if (settings.indent !== undefined) {
      this.indent = settings.indent;
    }
    if (settings.showBraces !== undefined) {
      this.showBraces = settings.showBraces;
    }
    if (settings.showSemicolons !== undefined) {
      this.showSemicolons = settings.showSemicolons;
    }
  }

  setZoomCallback(callback: (zoomLevel: number) => void) {
    this.onZoomChange = callback;
  }

  private setupEventListeners() {
    // Mouse wheel for zooming
    this.canvas.addEventListener("wheel", (e) => {
      e.preventDefault();

      // Accumulate wheel delta for smoother zooming
      this.wheelDelta += e.deltaY;

      // Only change zoom level when threshold is reached
      if (Math.abs(this.wheelDelta) >= this.wheelThreshold) {
        if (this.wheelDelta < 0) {
          // Zoom in - increase detail level
          this.zoomLevel = Math.min(this.maxNestingDepth, this.zoomLevel + 1);
        } else {
          // Zoom out - decrease detail level
          this.zoomLevel = Math.max(1, this.zoomLevel - 1);
        }

        // Reset accumulated delta
        this.wheelDelta = 0;

        // Notify React component of zoom change
        if (this.onZoomChange) {
          this.onZoomChange(this.zoomLevel);
        }

        this.redraw();
      }
    });

    // Mouse down for panning
    this.canvas.addEventListener("mousedown", (e) => {
      this.isPanning = true;
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
      this.canvas.style.cursor = "grabbing";
    });

    // Mouse move for panning
    this.canvas.addEventListener("mousemove", (e) => {
      if (this.isPanning) {
        const deltaX = e.clientX - this.lastMouseX;
        const deltaY = e.clientY - this.lastMouseY;

        this.panX += deltaX;
        this.panY += deltaY;

        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;

        this.redraw();
      }
    });

    // Mouse up to stop panning
    const stopPanning = () => {
      this.isPanning = false;
      this.canvas.style.cursor = "grab";
    };

    // Mouse leave to stop panning and reset wheel delta
    const handleMouseLeave = () => {
      this.isPanning = false;
      this.canvas.style.cursor = "grab";
      // Reset accumulated wheel delta when mouse leaves canvas
      this.wheelDelta = 0;
    };

    this.canvas.addEventListener("mouseup", stopPanning);
    this.canvas.addEventListener("mouseleave", handleMouseLeave);

    // Set initial cursor
    this.canvas.style.cursor = "grab";
  }

  private currentAst: ts.Node | null = null;
  private currentSourceFile: ts.SourceFile | null = null;

  private redraw() {
    if (this.currentAst && this.currentSourceFile) {
      this.render(this.currentAst, this.currentSourceFile);
    }
  }

  render(ast: ts.Node | null, sourceFile?: ts.SourceFile) {
    if (!ast) {
      return;
    }

    if (sourceFile) {
      this.sourceFile = sourceFile;
      this.currentSourceFile = sourceFile;
    }
    this.currentAst = ast;

    // Clear with proper DPI scaling
    const dpr = window.devicePixelRatio || 1;
    this.ctx.clearRect(0, 0, this.canvas.width / dpr, this.canvas.height / dpr);

    // Apply pan transformation
    this.ctx.save();
    this.ctx.translate(this.panX, this.panY);

    this.ctx.font = `${this.fontSize}px monospace`;
    this.ctx.textAlign = "left";
    this.ctx.textBaseline = "top";
    this.ctx.fillStyle = "#333";

    // Start rendering from nesting depth 1 (to align with zoom levels starting at 1)
    this.renderNode(ast, 20, 20, 0, 1);

    this.ctx.restore();
  }

  private renderNode(
    node: ts.Node,
    x: number,
    y: number,
    indentLevel: number,
    nestingDepth: number,
  ): number {
    if (!this.sourceFile) {
      return y;
    }

    // Dispatch to specific renderer based on node kind
    switch (node.kind) {
      case ts.SyntaxKind.SourceFile:
        return this.renderSourceFile(
          node as ts.SourceFile,
          x,
          y,
          indentLevel,
          nestingDepth,
        );
      case ts.SyntaxKind.FunctionDeclaration:
        return this.renderFunctionDeclaration(
          node as ts.FunctionDeclaration,
          x,
          y,
          indentLevel,
          nestingDepth,
        );
      case ts.SyntaxKind.VariableStatement:
        return this.renderVariableStatement(
          node as ts.VariableStatement,
          x,
          y,
          indentLevel,
          nestingDepth,
        );
      case ts.SyntaxKind.ExpressionStatement:
        return this.renderExpressionStatement(
          node as ts.ExpressionStatement,
          x,
          y,
          indentLevel,
          nestingDepth,
        );
      case ts.SyntaxKind.ReturnStatement:
        return this.renderReturnStatement(
          node as ts.ReturnStatement,
          x,
          y,
          indentLevel,
          nestingDepth,
        );
      case ts.SyntaxKind.Block:
        return this.renderBlock(
          node as ts.Block,
          x,
          y,
          indentLevel,
          nestingDepth,
        );
      case ts.SyntaxKind.IfStatement:
        return this.renderIfStatement(
          node as ts.IfStatement,
          x,
          y,
          indentLevel,
          nestingDepth,
        );
      case ts.SyntaxKind.CallExpression:
        return this.renderCallExpression(
          node as ts.CallExpression,
          x,
          y,
          indentLevel,
          nestingDepth,
        );
      case ts.SyntaxKind.BinaryExpression:
        return this.renderBinaryExpression(
          node as ts.BinaryExpression,
          x,
          y,
          indentLevel,
          nestingDepth,
        );
      case ts.SyntaxKind.Identifier:
        return this.renderIdentifier(
          node as ts.Identifier,
          x,
          y,
          indentLevel,
          nestingDepth,
        );
      case ts.SyntaxKind.StringLiteral:
        return this.renderStringLiteral(
          node as ts.StringLiteralLike,
          x,
          y,
          indentLevel,
          nestingDepth,
        );
      default:
        return this.renderGenericNode(node, x, y, indentLevel, nestingDepth);
    }
  }

  private renderSourceFile(
    node: ts.SourceFile,
    x: number,
    y: number,
    indentLevel: number,
    nestingDepth: number,
  ): number {
    let currentY = y;
    node.statements.forEach((statement) => {
      currentY = this.renderNode(
        statement,
        x,
        currentY,
        indentLevel,
        nestingDepth,
      );
      currentY += this.lineHeight * 0.5; // Add spacing between top-level statements
    });
    return currentY;
  }

  private renderFunctionDeclaration(
    node: ts.FunctionDeclaration,
    x: number,
    y: number,
    indentLevel: number,
    nestingDepth: number,
  ): number {
    const indentX = x + indentLevel * this.indent;
    let currentY = y;
    const isBlockScope = isBlockScopeNode(node);
    const childNestingDepth = isBlockScope ? nestingDepth + 1 : nestingDepth;

    // Render function keyword and signature with syntax highlighting
    this.ctx.fillStyle = this.colors.keyword;
    this.ctx.fillText("function", indentX, currentY);

    let currentX = indentX + this.ctx.measureText("function").width;

    if (node.name) {
      this.ctx.fillStyle = this.colors.identifier;
      this.ctx.fillText(
        " " + node.name.getText(this.sourceFile),
        currentX,
        currentY,
      );
      currentX += this.ctx.measureText(
        " " + node.name.getText(this.sourceFile),
      ).width;
    }

    this.ctx.fillStyle = this.colors.punctuation;
    this.ctx.fillText("(", currentX, currentY);
    currentX += this.ctx.measureText("(").width;

    // Add parameters
    node.parameters.forEach((param, index) => {
      if (index > 0) {
        this.ctx.fillStyle = this.colors.punctuation;
        this.ctx.fillText(", ", currentX, currentY);
        currentX += this.ctx.measureText(", ").width;
      }
      this.ctx.fillStyle = this.colors.identifier;
      const paramText = param.getText(this.sourceFile);
      this.ctx.fillText(paramText, currentX, currentY);
      currentX += this.ctx.measureText(paramText).width;
    });

    this.ctx.fillStyle = this.colors.punctuation;
    this.ctx.fillText(")", currentX, currentY);
    currentX += this.ctx.measureText(")").width;

    // Add return type
    if (node.type) {
      this.ctx.fillStyle = this.colors.punctuation;
      this.ctx.fillText(": ", currentX, currentY);
      currentX += this.ctx.measureText(": ").width;
      this.ctx.fillStyle = this.colors.type;
      const typeText = node.type.getText(this.sourceFile);
      this.ctx.fillText(typeText, currentX, currentY);
      currentX += this.ctx.measureText(typeText).width;
    }

    // Check if function body should be truncated
    if (childNestingDepth > this.zoomLevel) {
      if (this.showBraces) {
        this.ctx.fillStyle = this.colors.punctuation;
        this.ctx.fillText(" {", currentX, currentY);
      }
      currentY += this.lineHeight;

      // Render ellipsis on the next line with proper indentation
      const ellipsisIndentX = x + (indentLevel + 1) * this.indent;
      this.ctx.fillStyle = "orange"; // Orange color for ellipsis
      this.ctx.fillText("...", ellipsisIndentX, currentY);
      currentY += this.lineHeight;

      // Render closing brace if needed
      if (this.showBraces) {
        this.ctx.fillStyle = this.colors.punctuation;
        this.ctx.fillText("}", indentX, currentY);
        currentY += this.lineHeight;
      }

      return currentY;
    } else {
      if (this.showBraces) {
        this.ctx.fillStyle = this.colors.punctuation;
        this.ctx.fillText(" {", currentX, currentY);
      }
      currentY += this.lineHeight;

      // Render function body
      if (node.body) {
        currentY = this.renderBlock(
          node.body,
          x,
          currentY,
          indentLevel,
          childNestingDepth,
        );
      }

      return currentY;
    }
  }

  private renderVariableStatement(
    node: ts.VariableStatement,
    x: number,
    y: number,
    indentLevel: number,
    _nestingDepth: number,
  ): number {
    const indentX = x + indentLevel * this.indent;
    const text = node.getText(this.sourceFile);

    // Use syntax highlighting colors
    this.ctx.fillStyle = this.colors.default;
    this.ctx.fillText(text, indentX, y);

    if (this.showSemicolons) {
      this.ctx.fillStyle = this.colors.punctuation;
      this.ctx.fillText(";", indentX + this.ctx.measureText(text).width, y);
    }

    return y + this.lineHeight;
  }

  private renderExpressionStatement(
    node: ts.ExpressionStatement,
    x: number,
    y: number,
    indentLevel: number,
    nestingDepth: number,
  ): number {
    const indentX = x + indentLevel * this.indent;
    return this.renderNode(
      node.expression,
      indentX,
      y,
      indentLevel,
      nestingDepth,
    );
  }

  private renderReturnStatement(
    node: ts.ReturnStatement,
    x: number,
    y: number,
    indentLevel: number,
    _nestingDepth: number,
  ): number {
    const indentX = x + indentLevel * this.indent;
    let currentX = indentX;

    // Render 'return' keyword in blue
    this.ctx.fillStyle = this.colors.keyword;
    this.ctx.fillText("return", currentX, y);
    currentX += this.ctx.measureText("return").width;

    if (node.expression) {
      this.ctx.fillStyle = this.colors.default;
      const expressionText = " " + node.expression.getText(this.sourceFile);
      this.ctx.fillText(expressionText, currentX, y);
      currentX += this.ctx.measureText(expressionText).width;
    }

    if (this.showSemicolons) {
      this.ctx.fillStyle = this.colors.punctuation;
      this.ctx.fillText(";", currentX, y);
    }

    return y + this.lineHeight;
  }

  private renderBlock(
    node: ts.Block,
    x: number,
    y: number,
    indentLevel: number,
    nestingDepth: number,
  ): number {
    let currentY = y;
    const isBlockScope = isBlockScopeNode(node);
    const childNestingDepth = isBlockScope ? nestingDepth + 1 : nestingDepth;

    // Check if the entire block content should be truncated
    if (childNestingDepth > this.zoomLevel) {
      const indentX = x + (indentLevel + 1) * this.indent;
      this.ctx.fillStyle = "orange"; // Orange color for ellipsis
      this.ctx.fillText("...", indentX, currentY);
      this.ctx.fillStyle = "#333"; // Reset color
      currentY += this.lineHeight;
    } else {
      // Render statements inside block
      node.statements.forEach((statement) => {
        currentY = this.renderNode(
          statement,
          x,
          currentY,
          indentLevel + 1,
          childNestingDepth,
        );
      });
    }

    // Render closing brace
    if (this.showBraces) {
      const indentX = x + indentLevel * this.indent;
      this.ctx.fillStyle = this.colors.punctuation;
      this.ctx.fillText("}", indentX, currentY);
      currentY += this.lineHeight;
    }

    return currentY;
  }

  private renderIfStatement(
    node: ts.IfStatement,
    x: number,
    y: number,
    indentLevel: number,
    nestingDepth: number,
  ): number {
    const indentX = x + indentLevel * this.indent;
    let currentY = y;
    const isBlockScope = isBlockScopeNode(node);
    const childNestingDepth = isBlockScope ? nestingDepth + 1 : nestingDepth;

    // Render if statement and condition with syntax highlighting
    let currentX = indentX;

    this.ctx.fillStyle = this.colors.keyword;
    this.ctx.fillText("if", currentX, currentY);
    currentX += this.ctx.measureText("if").width;

    this.ctx.fillStyle = this.colors.punctuation;
    this.ctx.fillText(" (", currentX, currentY);
    currentX += this.ctx.measureText(" (").width;

    this.ctx.fillStyle = this.colors.default;
    const conditionText = node.expression.getText(this.sourceFile);
    this.ctx.fillText(conditionText, currentX, currentY);
    currentX += this.ctx.measureText(conditionText).width;

    this.ctx.fillStyle = this.colors.punctuation;
    this.ctx.fillText(")", currentX, currentY);
    currentX += this.ctx.measureText(")").width;

    if (this.showBraces) {
      this.ctx.fillText(" {", currentX, currentY);
    }
    currentY += this.lineHeight;

    // Render if body - check truncation for this specific branch
    if (childNestingDepth > this.zoomLevel) {
      const indentX = x + (indentLevel + 1) * this.indent;
      this.ctx.fillStyle = "orange"; // Orange color for ellipsis
      this.ctx.fillText("...", indentX, currentY);
      this.ctx.fillStyle = "#333"; // Reset color
      currentY += this.lineHeight;
    } else if (node.thenStatement) {
      if (node.thenStatement.kind === ts.SyntaxKind.Block) {
        currentY = this.renderBlock(
          node.thenStatement as ts.Block,
          x,
          currentY,
          indentLevel,
          childNestingDepth,
        );
      } else {
        currentY = this.renderNode(
          node.thenStatement,
          x,
          currentY,
          indentLevel + 1,
          childNestingDepth,
        );
      }
    }

    // Handle else/else-if chain - each branch is a separate block scope
    let currentElse = node.elseStatement;
    while (currentElse) {
      const elseIndentX = x + indentLevel * this.indent;

      if (currentElse.kind === ts.SyntaxKind.IfStatement) {
        // Handle "else if" - this is a separate block scope
        const elseIfNode = currentElse as ts.IfStatement;
        let currentX = elseIndentX;

        this.ctx.fillStyle = this.colors.keyword;
        this.ctx.fillText("else if", currentX, currentY);
        currentX += this.ctx.measureText("else if").width;

        this.ctx.fillStyle = this.colors.punctuation;
        this.ctx.fillText(" (", currentX, currentY);
        currentX += this.ctx.measureText(" (").width;

        this.ctx.fillStyle = this.colors.default;
        const conditionText = elseIfNode.expression.getText(this.sourceFile);
        this.ctx.fillText(conditionText, currentX, currentY);
        currentX += this.ctx.measureText(conditionText).width;

        this.ctx.fillStyle = this.colors.punctuation;
        this.ctx.fillText(")", currentX, currentY);
        currentX += this.ctx.measureText(")").width;

        if (this.showBraces) {
          this.ctx.fillText(" {", currentX, currentY);
        }
        currentY += this.lineHeight;

        // Check truncation for this else-if branch specifically
        if (childNestingDepth > this.zoomLevel) {
          const indentX = x + (indentLevel + 1) * this.indent;
          this.ctx.fillStyle = "orange"; // Orange color for ellipsis
          this.ctx.fillText("...", indentX, currentY);
          this.ctx.fillStyle = "#333"; // Reset color
          currentY += this.lineHeight;
        } else if (elseIfNode.thenStatement) {
          if (elseIfNode.thenStatement.kind === ts.SyntaxKind.Block) {
            currentY = this.renderBlock(
              elseIfNode.thenStatement as ts.Block,
              x,
              currentY,
              indentLevel,
              childNestingDepth,
            );
          } else {
            currentY = this.renderNode(
              elseIfNode.thenStatement,
              x,
              currentY,
              indentLevel + 1,
              childNestingDepth,
            );
          }
        }

        // Move to the next else statement in the chain
        currentElse = elseIfNode.elseStatement;
      } else {
        // Handle final else clause - this is a separate block scope
        this.ctx.fillStyle = this.colors.keyword;
        this.ctx.fillText("else", elseIndentX, currentY);

        if (this.showBraces) {
          this.ctx.fillStyle = this.colors.punctuation;
          this.ctx.fillText(
            " {",
            elseIndentX + this.ctx.measureText("else").width,
            currentY,
          );
        }
        currentY += this.lineHeight;

        // Check truncation for this else branch specifically
        if (childNestingDepth > this.zoomLevel) {
          const indentX = x + (indentLevel + 1) * this.indent;
          this.ctx.fillStyle = "orange"; // Orange color for ellipsis
          this.ctx.fillText("...", indentX, currentY);
          this.ctx.fillStyle = "#333"; // Reset color
          currentY += this.lineHeight;
        } else {
          if (currentElse.kind === ts.SyntaxKind.Block) {
            currentY = this.renderBlock(
              currentElse as ts.Block,
              x,
              currentY,
              indentLevel,
              childNestingDepth,
            );
          } else {
            currentY = this.renderNode(
              currentElse,
              x,
              currentY,
              indentLevel + 1,
              childNestingDepth,
            );
          }
        }

        // End of chain
        break;
      }
    }

    return currentY;
  }

  private renderCallExpression(
    node: ts.CallExpression,
    x: number,
    y: number,
    _indentLevel: number,
    _nestingDepth: number,
  ): number {
    this.ctx.fillStyle = this.colors.default;
    const text = node.getText(this.sourceFile);
    this.ctx.fillText(text, x, y);

    if (this.showSemicolons) {
      this.ctx.fillStyle = this.colors.punctuation;
      this.ctx.fillText(";", x + this.ctx.measureText(text).width, y);
    }

    return y + this.lineHeight;
  }

  private renderBinaryExpression(
    node: ts.BinaryExpression,
    x: number,
    y: number,
    _indentLevel: number,
    _nestingDepth: number,
  ): number {
    const text = node.getText(this.sourceFile);
    this.ctx.fillStyle = this.colors.default;
    this.ctx.fillText(text, x, y);
    return y + this.lineHeight;
  }

  private renderIdentifier(
    node: ts.Identifier,
    x: number,
    y: number,
    _indentLevel: number,
    _nestingDepth: number,
  ): number {
    const text = node.getText(this.sourceFile);
    this.ctx.fillStyle = this.colors.identifier;
    this.ctx.fillText(text, x, y);
    return y + this.lineHeight;
  }

  private renderStringLiteral(
    node: ts.StringLiteralLike,
    x: number,
    y: number,
    _indentLevel: number,
    _nestingDepth: number,
  ): number {
    const text = node.getText(this.sourceFile);
    this.ctx.fillStyle = this.colors.string;
    this.ctx.fillText(text, x, y);
    return y + this.lineHeight;
  }

  private renderGenericNode(
    node: ts.Node,
    x: number,
    y: number,
    indentLevel: number,
    nestingDepth: number,
  ): number {
    const indentX = x + indentLevel * this.indent;
    const text = node.getText(this.sourceFile);

    // Handle simple nodes that fit on one line
    if (text.length < 100 && !text.includes("\n")) {
      this.ctx.fillText(text, indentX, y);
      return y + this.lineHeight;
    }

    // For complex nodes, render children individually
    let currentY = y;
    const children = node.getChildren(this.sourceFile);
    const isBlockScope = isBlockScopeNode(node);
    const childNestingDepth = isBlockScope ? nestingDepth + 1 : nestingDepth;

    children.forEach((child) => {
      currentY = this.renderNode(
        child,
        x,
        currentY,
        indentLevel,
        childNestingDepth,
      );
    });

    return currentY;
  }
}

export default function DionPage() {
  const [code, setCode] = useState(`function someFn(name: string): number {
  function meep() {
    if (Math.random() < 0.5) {
      if (Math.random() < 0.5) {
        return 4
      } else if (Math.random() < 0.7) {
        return 4
      } else {
        return 4
      }
    } else if (Math.random() < 0.7) {
      return 3
    }
    return 2
  }
  return 1;
}

function greet(name: string): string {
  return "Hello," + name + " 1!";
}`);

  const [ast, setAst] = useState<ts.Node | null>(null);
  const [sourceFile, setSourceFile] = useState<ts.SourceFile | null>(null);
  const [maxNestingDepth, setMaxNestingDepth] = useState(1);

  // UI control states
  const [zoomLevel, setZoomLevel] = useState(1);
  const [indentSize, setIndentSize] = useState(20);
  const [showBraces, setShowBraces] = useState(false);
  const [showSemicolons, setShowSemicolons] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<ASTCanvasRenderer | null>(null);
  const editorRef = useRef<editor.IStandaloneCodeEditor>(null);
  const isClient = typeof window !== "undefined";

  // Function to check if there are syntax errors in Monaco editor
  const hasSyntaxErrors = async (): Promise<boolean> => {
    if (!editorRef.current || typeof window === "undefined") {
      return true;
    }

    const model = editorRef.current.getModel();
    if (!model) {
      return true;
    }

    try {
      const markers = editor.getModelMarkers({ owner: "typescript" });
      // Check for syntax/semantic errors (severity 8 = error, 4 = warning, 1 = hint)
      return markers.some((marker) => marker.severity === MarkerSeverity.Error);
    } catch {
      return true;
    }
  };

  // Auto-generate AST when code changes (if no syntax errors)
  const autoGenerateAST = useCallback(
    (newCode: string) => {
      setCode(newCode);

      // Small delay to let Monaco update its diagnostics
      setTimeout(async () => {
        const hasErrors = await hasSyntaxErrors();
        if (!hasErrors) {
          try {
            const sourceFile = ts.createSourceFile(
              "temp.ts",
              newCode,
              ts.ScriptTarget.Latest,
              true,
              ts.ScriptKind.TS,
            );

            const maxDepth = calculateMaxNestingDepth(sourceFile);

            setSourceFile(sourceFile);
            setAst(sourceFile);
            setMaxNestingDepth(maxDepth);

            // Keep current zoom level if it's within bounds, otherwise set to max
            if (zoomLevel > maxDepth) {
              setZoomLevel(maxDepth);
            }
          } catch (error) {
            console.error("Error generating AST:", error);
            // Don't clear existing AST on error, just log it
          }
        }
      }, 300); // 300ms delay to let Monaco process the changes
    },
    [zoomLevel],
  );

  // Generate initial AST when component mounts
  useEffect(() => {
    if (typeof window !== "undefined") {
      setTimeout(() => {
        try {
          const sourceFile = ts.createSourceFile(
            "temp.ts",
            code,
            ts.ScriptTarget.Latest,
            true,
            ts.ScriptKind.TS,
          );
          const maxDepth = calculateMaxNestingDepth(sourceFile);
          setSourceFile(sourceFile);
          setAst(sourceFile);
          setMaxNestingDepth(maxDepth);
          setZoomLevel(maxDepth);
        } catch (error) {
          console.error("Error generating initial AST:", error);
        }
      }, 100);
    }
  }, [code]);

  useEffect(() => {
    if (canvasRef.current && !rendererRef.current) {
      rendererRef.current = new ASTCanvasRenderer(canvasRef.current);

      // Set up zoom synchronization callback
      rendererRef.current.setZoomCallback((newZoom: number) => {
        setZoomLevel(newZoom);
      });
    }
  }, []);

  // Update renderer settings when controls change (except zoom to prevent loops)
  useEffect(() => {
    if (rendererRef.current) {
      rendererRef.current.updateSettings({
        indent: indentSize,
        showBraces: showBraces,
        showSemicolons: showSemicolons,
        maxNestingDepth: maxNestingDepth,
      });
      if (ast && sourceFile) {
        rendererRef.current.render(ast, sourceFile);
      }
    }
  }, [
    indentSize,
    showBraces,
    showSemicolons,
    maxNestingDepth,
    ast,
    sourceFile,
  ]);

  // Handle zoom level changes from UI (separate to prevent loops)
  useEffect(() => {
    if (rendererRef.current) {
      rendererRef.current.updateSettings({
        zoomLevel: zoomLevel,
      });
      if (ast && sourceFile) {
        rendererRef.current.render(ast, sourceFile);
      }
    }
  }, [zoomLevel, ast, sourceFile]);

  return (
    <div className="mx-auto p-4 w-screen absolute left-0">
      {/* Controls Panel */}
      <div className="bg-gray-50 border rounded-lg p-4 mb-4">
        <div className="grid grid-cols-3 gap-6">
          {/* Zoom Control */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Nesting Level: {zoomLevel} / {maxNestingDepth}
            </label>
            <input
              type="range"
              min="1"
              max={maxNestingDepth}
              step="1"
              value={zoomLevel}
              onChange={(e) => setZoomLevel(parseInt(e.target.value))}
              className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
              disabled={maxNestingDepth <= 1}
            />
            <div className="flex justify-between text-xs text-gray-500 mt-1">
              <span>Level 1</span>
              <span>Level {maxNestingDepth}</span>
            </div>
          </div>

          {/* Indentation Control */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Indent Size: {indentSize}px
            </label>
            <input
              type="range"
              min="10"
              max="60"
              step="5"
              value={indentSize}
              onChange={(e) => setIndentSize(parseInt(e.target.value))}
              className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
            />
            <div className="flex justify-between text-xs text-gray-500 mt-1">
              <span>10px</span>
              <span>60px</span>
            </div>
          </div>

          {/* Display Options */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Display Options
            </label>
            <div className="space-y-2">
              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="showBraces"
                  checked={showBraces}
                  onChange={(e) => setShowBraces(e.target.checked)}
                  className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                />
                <label
                  htmlFor="showBraces"
                  className="ml-2 text-sm text-gray-700"
                >
                  Show curly braces
                </label>
              </div>
              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="showSemicolons"
                  checked={showSemicolons}
                  onChange={(e) => setShowSemicolons(e.target.checked)}
                  className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                />
                <label
                  htmlFor="showSemicolons"
                  className="ml-2 text-sm text-gray-700"
                >
                  Show semicolons
                </label>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 h-[calc(100vh-200px)]">
        {/* Code Editor Column */}
        <div className="border border-gray-300 rounded-lg overflow-hidden">
          <div className="bg-gray-100 p-2 border-b">
            <p className="font-semibold">Code Editor</p>
          </div>
          <div className="h-full">
            <Editor
              height="100%"
              defaultLanguage="typescript"
              value={code}
              onMount={(editor) => {
                editorRef.current = editor;
              }}
              onChange={(value) => autoGenerateAST(value || "")}
              theme="light"
              options={{
                minimap: { enabled: false },
                fontSize: 14,
                lineNumbers: "on",
                automaticLayout: true,
              }}
            />
          </div>
        </div>

        {/* AST View Column */}
        <div className="border border-gray-300 rounded-lg overflow-hidden flex flex-col">
          <div className="bg-gray-100 p-2 border-b flex items-center justify-between">
            <p className="font-semibold">AST View</p>
          </div>
          <div className="flex-1 p-4 overflow-auto">
            {ast && isClient ? (
              <ReactJson
                src={ast}
                theme="bright:inverted"
                name="ast"
                displayDataTypes={false}
                displayObjectSize={false}
                enableClipboard={false}
                collapsed={2}
                style={{
                  backgroundColor: "transparent",
                  fontSize: "12px",
                }}
              />
            ) : (
              <p className="text-gray-500">
                {ast
                  ? "Loading JSON viewer..."
                  : 'Click "Generate AST" to see the parsed AST'}
              </p>
            )}
          </div>
        </div>

        {/* Canvas Renderer Column */}
        <div className="border border-gray-300 rounded-lg overflow-hidden flex flex-col">
          <div className="bg-gray-100 p-2 border-b">
            <p className="font-semibold">Visual AST Renderer</p>
          </div>
          <div className="flex-1 overflow-auto">
            <canvas
              ref={canvasRef}
              width={400}
              height={800}
              className="w-full"
              style={{ minHeight: "600px" }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
