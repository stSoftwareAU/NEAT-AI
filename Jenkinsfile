/* groovylint-disable DuplicateNumberLiteral, DuplicateStringLiteral, GStringExpressionWithinString, LineLength, NestedBlockDepth */
/* groovylint-disable-next-line CompileStatic */
DENO_IMAGE = 'denoland/deno:latest'
/* groovylint-disable-next-line GStringExpressionWithinString */
TOOLS_ARGS = '-e DENO_DIR=${WORKSPACE}/.deno --rm --volume /var/run/docker.sock:/var/run/docker.sock --volume /tmp:/tmp'
TOOLS_IMAGE = "${ECR}/develop/sts-tools:latest"


pipeline {
    agent none
    triggers {
        pollSCM('* * * * *')
    }

    options {
        timeout(time: 1, unit: 'HOURS')
        disableConcurrentBuilds()
    }

    stages {
        stage('Checks') {
            parallel {
                stage('Lint & Format') {
                    agent {
                        docker {
                            image DENO_IMAGE
                            args TOOLS_ARGS
                            label 'small'
                        }
                    }
                    steps {
                        sh '''\
                          #!/bin/bash

                          echo "Remove old test files"
                          find test -name ".*.json" -exec rm {} \\;

                          deno lint src

                          deno fmt --check src test
                          deno check `find src -name "*.ts"`
                        '''.stripIndent()
                    }
                }
                stage('Typos') {
                    agent {
                        docker {
                            image TOOLS_IMAGE
                            args TOOLS_ARGS
                            label 'small'
                        }
                    }
                    steps {
                        sh '''\
                          #!/bin/bash

                          docker run --rm -t -v $(pwd)/src:/src imunew/typos-cli /src --format brief \
                            --exclude Costs.ts \
                            --exclude "**/MAPE.ts" \
                            > .typos.txt

                          if [ -s .typos.txt ]; then
                            cat .typos.txt
                            exit 1
                          fi
                        '''.stripIndent()
                    }
                }
                stage('Test') {
                    agent {
                        docker {
                            image DENO_IMAGE
                            args TOOLS_ARGS
                            label 'large'
                        }
                    }
                    steps {
                        sh '''\
                          #!/bin/bash

                          deno test \
                            --allow-read \
                            --allow-write \
                            --trace-leaks \
                            --v8-flags=--max-old-space-size=8192 \
                            --parallel \
                            --config ./test/deno.json \
                            --coverage=.coverage \
                            --doc \
                            --reporter junit > .test.xml

                        '''.stripIndent()
                    }
                    post {
                        always {
                            junit '.test.xml'
                            sh 'deno coverage .coverage --lcov --output=.coverage/cov.lcov'

                            sh 'deno coverage --html .coverage'

                            stash(name: 'coverage', includes: '.coverage/**')

                            publishHTML(
                                target : [
                                    allowMissing: false,
                                    alwaysLinkToLastBuild: true,
                                    keepAll: true,
                                    reportDir: '.coverage/html',
                                    reportFiles: 'index.html',
                                    reportName: 'Coverage'
                                ]
                            )
                        }
                    }
                }
            }
        }

        stage('Coverage') {
            agent {
                docker {
                    image TOOLS_IMAGE
                    args TOOLS_ARGS
                    label 'small'
                }
            }

            steps {
                unstash(name: 'coverage')

                sh '''\
                  #!/bin/bash

                  # Convert LCOV to Cobertura XML
                  lcov_cobertura --base-dir src --output coverage.xml .coverage/cov.lcov

                '''.stripIndent()

                // Publish Cobertura report
                recordCoverage(
                  tools: [[parser: 'COBERTURA', pattern: 'coverage.xml']],
                  id: 'Cobertura',
                  name: 'Cobertura Coverage',
                  sourceCodeRetention: 'EVERY_BUILD',
                  qualityGates: [
                    [threshold: 60.0, metric: 'LINE', baseline: 'PROJECT', unstable: true],
                    [threshold: 60.0, metric: 'BRANCH', baseline: 'PROJECT', unstable: true]
                  ]
                )
            }
        }
    }
}
