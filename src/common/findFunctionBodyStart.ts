const enum CharCodes {
    Dollar = 36,
    OpenBrace = 123,
    CloseBrace = 125,
    OpenParenthesis = 40,
    CloseParenthesis = 41,
    DoubleQuote = 34,
    SingleQuote = 39,
    Backtick = 96,
    Backslash = 92,
    Equals = 61,
    GreaterThan = 62,
    Tab = 9,
    Newline = 10,
    VerticalTab = 11,
    FormFeed = 12,
    CarriageReturn = 13,
    Space = 32
}

function isWhitespace(code: number) {
    return code === CharCodes.Space
        || code === CharCodes.Tab
        || code === CharCodes.Newline
        || code === CharCodes.VerticalTab
        || code === CharCodes.FormFeed
        || code === CharCodes.CarriageReturn;
}

function findEndOfString(moduleString: string, startIndex: number, quoteChar: CharCodes) {
    let shouldEscape = false;

    for (let i = startIndex; i < moduleString.length; i++) {
        const code = moduleString.charCodeAt(i);

        if (code === quoteChar && !shouldEscape) return i;

        if (code === CharCodes.Backslash) shouldEscape = !shouldEscape;
        else shouldEscape = false;
    }

    return moduleString.length;
}

function findEndOfTemplateLiteral(moduleString: string, startIndex: number) {
    let depth = 0;
    let lastCode = 0;
    let shouldEscape = false;

    for (let i = startIndex; i < moduleString.length; i++) {
        const code = moduleString.charCodeAt(i);

        if (depth === 0) {
            if (code === CharCodes.Backtick && !shouldEscape) {
                return i;
            }

            if (code === CharCodes.OpenBrace && lastCode === CharCodes.Dollar && !shouldEscape) {
                depth++;
            }

            if (code === CharCodes.Backslash) shouldEscape = !shouldEscape;
            else if (lastCode !== CharCodes.Dollar) shouldEscape = false;
        }
        else {
            if (code === CharCodes.Backtick) {
                i = findEndOfTemplateLiteral(moduleString, i + 1);
            }
            else if (code === CharCodes.DoubleQuote || code === CharCodes.SingleQuote) {
                i = findEndOfString(moduleString, i + 1, code);
            }
            else if (code === CharCodes.OpenBrace) {
                depth++;
            }
            else if (code === CharCodes.CloseBrace) {
                depth--;
            }
        }

        lastCode = code;
    }

    return moduleString.length;
}

export default function findFunctionBodyStart(moduleString: string) {
    const paramsStart = moduleString.indexOf("(");
    if (paramsStart === -1) return -1;

    let depth = 0;

    for (let i = paramsStart; i < moduleString.length; i++) {
        const code = moduleString.charCodeAt(i);

        if (code === CharCodes.DoubleQuote || code === CharCodes.SingleQuote) {
            i = findEndOfString(moduleString, i + 1, code);
            continue;
        }

        if (code === CharCodes.Backtick) {
            i = findEndOfTemplateLiteral(moduleString, i + 1);
            continue;
        }

        if (code === CharCodes.OpenParenthesis) {
            depth++;
            continue;
        }

        if (code !== CharCodes.CloseParenthesis) continue;

        depth--;
        if (depth !== 0) continue;

        let bodyStart = i + 1;

        while (bodyStart < moduleString.length && isWhitespace(moduleString.charCodeAt(bodyStart))) {
            bodyStart++;
        }

        if (
            moduleString.charCodeAt(bodyStart) === CharCodes.Equals
            && moduleString.charCodeAt(bodyStart + 1) === CharCodes.GreaterThan
        ) {
            bodyStart += 2;

            while (bodyStart < moduleString.length && isWhitespace(moduleString.charCodeAt(bodyStart))) {
                bodyStart++;
            }
        }

        if (moduleString.charCodeAt(bodyStart) !== CharCodes.OpenBrace) return -1;

        return bodyStart + 1;
    }

    return -1;
}
