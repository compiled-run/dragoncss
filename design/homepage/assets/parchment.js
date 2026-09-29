// Injects the SVG filters the parchment uses (torn edge, ink bleed). Include once per page.
(function () {
  const svg = `<svg width="0" height="0" style="position:absolute" aria-hidden="true">
    <filter id="deckle" x="-3%" y="-3%" width="106%" height="106%">
      <feTurbulence type="fractalNoise" baseFrequency="0.045" numOctaves="5" seed="11" result="n"/>
      <feDisplacementMap in="SourceGraphic" in2="n" scale="22" xChannelSelector="R" yChannelSelector="G"/>
    </filter>
    <filter id="ink-bleed">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="4" result="n"/>
      <feDisplacementMap in="SourceGraphic" in2="n" scale="1.6"/>
    </filter>
  </svg>`;
  document.addEventListener('DOMContentLoaded', () => document.body.insertAdjacentHTML('afterbegin', svg));
})();
