import express from 'express';
import bodyParser from 'body-parser';
import NodeCache from 'node-cache';
import cors from 'cors';

const cacheControl = new NodeCache({ stdTTL: 3600, deleteOnExpire: true });
const app = express();

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

const repoToQueryName = (repo) => {
	const [owner, name] = repo.split('/');
	return `query__owner_${owner.replace(/\-/g, '_')}__name_${name.replace(/\-/g, '_')}`;
};

app.use(bodyParser.json());
app.use(cors());


app.post('/getrepos', async function (req, res) {
	res.set({
		'Content-Type': 'application/json',
		'Access-Control-Allow-Origin': '*',
	});

	const bodyJson = req.body;
	let repos = bodyJson?.repos ?? [];
	repos = repos.filter(repo => repo.match(/^[a-z0-9\-]+\/[a-z0-9\-]+$/i));

	console.log(repos);

	if (repos.length === 0) {
		res.send("{}");
		return;
	}


	const result = {};

	const toBeQueried = [];

	for (const repo of repos) {
		const cached = cacheControl.get(repo);
		if (cached) {
			result[repo] = cached;
		} else {
			toBeQueried.push(repo);
		}
	}

	if (toBeQueried.length) {
		const query = `
			fragment repoProperties on Repository {
				nameWithOwner
				url
				description
				homepageUrl
				stargazerCount
				forkCount
				createdAt
				pushedAt
				issues {
					totalCount
				}
				pullRequests {
					totalCount
				}
				discussions {
					totalCount
				}
				releases {
					totalCount
				}
				languages(first: 100) {
					nodes {
						color
						name
					}
				}
				defaultBranchRef {
					target {
						... on Commit {
							history {
								totalCount
							}
						}
					}
				}
				diskUsage
			}
			{
				${toBeQueried.map(repo => `
					${repoToQueryName(repo)}: repository(owner: "${repo.split('/')[0]}", name: "${repo.split('/')[1]}") {
						...repoProperties
					}
				`)}
			}
		`;

		const response = await fetch('https://api.github.com/graphql', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `bearer ${GITHUB_TOKEN}`,
			},
			body: JSON.stringify({ query }),
		});

		const json = await response.json();

		for (const repo of toBeQueried) {
			let repoData = json?.data[repoToQueryName(repo)];
			if (repoData) {
				repoData.hasData = true;
			} else {
				repoData = {
					hasData: false
				};
			}
			cacheControl.set(repo, repoData);
			result[repo] = repoData;
		}
	}

	res.send(JSON.stringify(result));
});


app.listen(process.env.PORT || 3000);
