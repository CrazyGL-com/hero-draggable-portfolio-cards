import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import * as React from 'react';
import CrazyGLWrapper, { useContent, useHeroReady, } from '@crazygl/core';
import metadata from './metadata.json';
import './style.css';
const PortfolioStage = React.lazy(() => import('./PortfolioStage'));
function DraggablePortfolioCardsHero(props) {
    const { size, input, seed, reducedMotion, rootRef, 
    // Card images
    card1Image = 'https://crazygl.com/samples/nature1.avif', card2Image = 'https://crazygl.com/samples/nature2.avif', card3Image = 'https://crazygl.com/samples/nature3.avif', card4Image = 'https://crazygl.com/samples/nature4.avif', card5Image = 'https://crazygl.com/samples/nature5.avif', cardCount = 5, stackOffsetX = 0.11, stackOffsetY = 0.07, stackOffsetZ = 0.05, cardSize = 2.1, groupOffsetX = 0.85, groupOffsetY = -0.02, cardCornerRadius = 0.07, fanDistance = 0.32, fanRotation = 0.06, springStiffness = 180, springDamping = 14, cursorTilt = 0.62, ambientFloat = 0.28, edgeGlowColor = '#ffd77d', edgeGlowStrength = 0.34, shadowStrength = 0.55, keyColor = '#fff8ee', fillColor = '#b8d4ff', screenBrightness = 0.42, contentAlign = 'start', paddingX = 64, paddingY = 48, bgTop = '#16131b', bgBottom = '#07060a', } = props;
    const content = useContent(props);
    useHeroReady(props);
    const [mounted, setMounted] = React.useState(false);
    React.useEffect(() => setMounted(true), []);
    const align = contentAlign === 'end'
        ? { justifyContent: 'flex-end', textAlign: 'right' }
        : contentAlign === 'center'
            ? { justifyContent: 'center', textAlign: 'center' }
            : { justifyContent: 'flex-start', textAlign: 'left' };
    const screenshots = React.useMemo(() => [card1Image, card2Image, card3Image, card4Image, card5Image], [card1Image, card2Image, card3Image, card4Image, card5Image]);
    return (_jsxs(_Fragment, { children: [_jsx("crazygl-stage", { style: {
                    position: 'absolute',
                    inset: 0,
                    zIndex: 0,
                    overflow: 'hidden',
                    background: `linear-gradient(180deg, ${bgTop} 0%, ${bgBottom} 100%)`,
                }, children: mounted ? (_jsx(React.Suspense, { fallback: null, children: _jsx(PortfolioStage, { rootRef: rootRef, size: size, input: input, seed: seed, reducedMotion: reducedMotion, screenshots: screenshots, cardCount: cardCount, stackOffsetX: stackOffsetX, stackOffsetY: stackOffsetY, stackOffsetZ: stackOffsetZ, cardSize: cardSize, groupOffsetX: groupOffsetX, groupOffsetY: groupOffsetY, cardCornerRadius: cardCornerRadius, fanDistance: fanDistance, fanRotation: fanRotation, springStiffness: springStiffness, springDamping: springDamping, cursorTilt: cursorTilt, ambientFloat: ambientFloat, edgeGlowColor: edgeGlowColor, edgeGlowStrength: edgeGlowStrength, shadowStrength: shadowStrength, keyColor: keyColor, fillColor: fillColor, screenBrightness: screenBrightness }) })) : null }), _jsx("crazygl-content", { style: {
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    alignItems: 'center',
                    zIndex: 1,
                    pointerEvents: 'none',
                    padding: `${paddingY}px ${paddingX}px`,
                    ...align,
                }, children: _jsx("div", { className: "crazygl-cs-content", children: content.node }) })] }));
}
export { metadata };
export default function DraggablePortfolioCards(props) {
    return _jsx(CrazyGLWrapper, { hero: DraggablePortfolioCardsHero, metadata: metadata, ...props });
}
