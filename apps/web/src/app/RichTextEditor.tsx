"use client";

import { useEffect, useRef } from "react";
import { Bold, Heading, Image as ImageIcon, Italic, Link2, List } from "lucide-react";

type RichTextEditorProps = {
  value: string;
  onChange: (html: string) => void;
  onRequestImage?: () => Promise<string | null>;
  placeholder?: string;
};

// Minimal dependency-free rich text editor (contenteditable + toolbar) for the
// lesson body: headings, bold, italic, lists, links and inserted images.
export function RichTextEditor({ value, onChange, onRequestImage, placeholder }: RichTextEditorProps) {
  const ref = useRef<HTMLDivElement>(null);

  // Set the HTML only when it differs from what's already rendered, so typing
  // (which fires onChange) does not reset the caret on each render.
  useEffect(() => {
    const el = ref.current;
    if (el && el.innerHTML !== value) {
      el.innerHTML = value || "";
    }
  }, [value]);

  function exec(command: string, arg?: string) {
    ref.current?.focus();
    document.execCommand(command, false, arg);
    if (ref.current) {
      onChange(ref.current.innerHTML);
    }
  }

  function insertHtml(html: string) {
    ref.current?.focus();
    document.execCommand("insertHTML", false, html);
    if (ref.current) {
      onChange(ref.current.innerHTML);
    }
  }

  async function handleImage() {
    if (!onRequestImage) {
      return;
    }
    const url = await onRequestImage();
    if (url) {
      insertHtml(`<img src="${url.replaceAll('"', "&quot;")}" alt="" />`);
    }
  }

  function handleLink() {
    const url = window.prompt("URL del enlace:");
    if (url) {
      exec("createLink", url);
    }
  }

  return (
    <div className="rte">
      <div className="rte-toolbar">
        <button type="button" title="Título" onClick={() => exec("formatBlock", "h2")}>
          <Heading aria-hidden />
        </button>
        <button type="button" title="Negrita" onClick={() => exec("bold")}>
          <Bold aria-hidden />
        </button>
        <button type="button" title="Cursiva" onClick={() => exec("italic")}>
          <Italic aria-hidden />
        </button>
        <button type="button" title="Lista" onClick={() => exec("insertUnorderedList")}>
          <List aria-hidden />
        </button>
        <button type="button" title="Enlace" onClick={handleLink}>
          <Link2 aria-hidden />
        </button>
        {onRequestImage ? (
          <button type="button" title="Insertar imagen" onClick={handleImage}>
            <ImageIcon aria-hidden />
          </button>
        ) : null}
      </div>
      <div
        ref={ref}
        className="rte-area"
        contentEditable
        suppressContentEditableWarning
        data-placeholder={placeholder ?? "Escribe el contenido de la clase…"}
        onInput={(event) => onChange((event.target as HTMLDivElement).innerHTML)}
      />
    </div>
  );
}
