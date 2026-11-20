export function App() @{
	<div class="stack">
		<style>
			.stack { display: flex; flex-direction: column; gap: 6px; align-items: flex-start; width: 200px; padding: 4px; background-color: #eee; }
			.row { display: flex; flex-direction: row; gap: 4px 8px; align-items: center; justify-content: space-between; width: 180px; background-color: #cde; }
			.a { width: 20px; height: 10px; background-color: #c33; }
			.b { width: 30px; height: 24px; background-color: #3c3; }
			.c { width: 10px; height: 16px; background-color: #33c; }
			.col { display: flex; flex-direction: column; gap: 3px; align-items: flex-end; justify-content: center; width: 60px; height: 50px; background-color: #ddc; }
		</style>
		<div class="row">
			<div class="a"></div>
			<div class="b"></div>
			<div class="c"></div>
		</div>
		<div class="col">
			<div class="a"></div>
			<div class="c"></div>
		</div>
	</div>
}
